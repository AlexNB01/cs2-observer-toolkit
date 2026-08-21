import type { GsiPayload, GsiPlayer, KillEvent, NormalizedEvent, ObserverQueueItem } from "@cs2hud/shared";
import { broadcast } from "../ws/hub.js";

const QUEUE_LIMIT = 8;
const TRADE_WINDOW_MS = 5_000;
const RECENT_DEATH_WINDOW_MS = TRADE_WINDOW_MS * 2;
const BROADCAST_MIN_INTERVAL_MS = 500;

/**
 * Every player has a single continuous score, recomputed from scratch
 * every GSI tick, made of two kinds of contribution:
 *  - Decaying event score: discrete moments that already happened (a
 *    kill, a shot fired) add a one-time boost that fades on its own
 *    rather than being shown once and then vanishing — a kill stays
 *    "interesting" for a few seconds afterward, not zero the instant the
 *    camera first cuts to it. How fast it fades isn't fixed — see
 *    decayHalfLifeFor: an enemy still in view means the moment probably
 *    isn't actually over, so it decays slower the closer that enemy is;
 *    looking somewhere with no enemy in sight at all (even one standing
 *    right behind them) means they've moved on, so it decays faster than
 *    the plain baseline instead.
 *  - Situational score: conditions that are true *right now* (clutch,
 *    a contested defuse, near an enemy, holding an unnoticed angle on one
 *    (see bumpFlankPotential)) are recomputed fresh every tick from the
 *    current payload — no history needed, since they naturally reach zero
 *    the moment the condition stops being true.
 * auto-switch.ts picks whoever has the highest total, but only actually
 * switches away from the current player once a challenger clearly beats
 * them (see SWITCH_MARGIN there) — that hysteresis on the switch
 * *decision*, not this scoring, is what stops the camera from thrashing
 * between two players with near-identical scores.
 */
const EVENT_SCORE_HALF_LIFE_MS = 5_000;
// Upper end of the half-life range, reached once an in-view enemy is right
// on top of the player — see decayHalfLifeFor. Nowhere near instant (the
// baseline is already only 5s), but enough that a brief mid-fight lull
// (reloading, re-peeking, a teammate trading instead) doesn't tank their
// score just because the fight is still developing.
const EVENT_SCORE_HALF_LIFE_NEAR_ENEMY_MS = 12_000;
// Faster than the plain baseline — used instead of it when the player has
// no enemy anywhere in view at all (see nearestEnemyClosenessInView). Not
// watching for a threat at all is a stronger "this is over" signal than
// merely being far from the nearest one, so it decays quicker than the
// baseline rather than just skipping the near-enemy bonus.
const EVENT_SCORE_HALF_LIFE_NO_ENEMY_IN_SIGHT_MS = 2_500;

const KILL_BASE = 100;
const HEADSHOT_BONUS = 15;
const MULTI_KILL_BONUS_PER_KILL = 25;
const TRADE_BONUS = 30;
const CLUTCH_WIN_BASE_BONUS = 40;
const CLUTCH_WIN_BONUS_PER_ENEMY = 20;
const ENGAGING_SHOT_BOOST = 10;
// Extra per-shot boost when the shooter is roughly aimed at an alive enemy
// within PROXIMITY_RANGE_UNITS (see isShootingTowardEnemy) — distinguishes
// an actual exchange from spraying a wall or firing with nobody in view,
// which only ever gets the base boost. Uses SHOOTING_AT_ENEMY_COS_THRESHOLD
// rather than FLANK_VIEW_COS_THRESHOLD's wider cone, since this is meant to
// approximate an actual shot direction, not just general awareness.
const ENGAGING_SHOOTING_AT_ENEMY_BONUS = 15;
// Hard ceiling on the engaging (shots-fired) contribution, independent of
// weapon fire rate or magazine size. Without this, a high-RPM/large-mag
// weapon (Negev: ~750rpm, 150-round mag) held on full auto into a wall
// converges to a steady-state score of roughly rate * boost *
// (halfLife/ln2) ≈ 12.5 * 10 * 7.2s ≈ 900 — comfortably clutch-tier —
// just from spraying, with nobody actually being fought. Capping the
// *decayed value* at read time bounds that regardless of rate or
// duration; it can't be raised by firing faster or longer. Raised
// alongside ENGAGING_SHOOTING_AT_ENEMY_BONUS so a genuine firefight (boost +
// bonus per shot) can actually separate itself from a lone wall-spray
// (boost only) instead of both saturating the same ceiling equally fast.
const ENGAGING_CAP = 45;

const CLUTCH_SITUATIONAL_BASE = 1000;
const CLUTCH_SITUATIONAL_PER_ENEMY = 10;
const BOMB_SITUATIONAL = 500;
const PROXIMITY_MAX = 10;
const PROXIMITY_RANGE_UNITS = 1200; // distance at which proximity's contribution reaches 0
// AWP/SSG08/Scout duels routinely happen well past PROXIMITY_RANGE_UNITS/
// FLANK_RANGE_UNITS/PUSH_TARGET_RANGE_UNITS (those are tuned for rifle/CQC
// engagement distances) — long sightlines like Dust2 long-A or Mirage mid
// are easily 2000+ units. Without a longer range for a sniper holder, they
// never register as "watching an angle" before the shot, and worse, right
// after a pick nearestEnemyClosenessInView reads back "no enemy nearby" and
// decays their kill score at the fast NO_ENEMY_IN_SIGHT rate instead of the
// slower near-enemy rate — cutting the camera away almost immediately after
// an AWP kill instead of holding on them like it would for a rifle duel.
const SNIPER_RANGE_UNITS = 2500;

// A "stack": several teammates moving together as a group, rather than
// spread out on separate default spots — usually means a coordinated
// execute/rush (T) or rotate/retake (CT) is about to happen, before
// there's any kill or plant to react to yet.
const STACK_MIN_PLAYERS = 3;
const STACK_RADIUS_UNITS = 600; // how close together counts as "one pack"
const STACK_MIN_SPEED_UPS = 100; // units/sec — CS2 walk speed is ~130, so this filters out "just standing near each other"
const BOMB_STACK_SITUATIONAL = 80; // T's stacked with the bomb still being carried (not yet planting — that's BOMB_SITUATIONAL)
const CT_STACK_SITUATIONAL = 35; // softer signal — CTs grouping up is common and only sometimes means something's about to happen
// How far a detected T stack has to be from a defending CT before it's
// worth bumping that CT for holding against it — same idea as
// FLANK_RANGE_UNITS, just from the defender's side of the interaction.
const PUSH_TARGET_RANGE_UNITS = 1000;
// Duel-tier, same as FLANK_POTENTIAL_MAX — a defender who's actually
// watching a push arrive deserves the camera as much as someone holding an
// unnoticed angle.
const PUSH_TARGET_SITUATIONAL = 45;

interface DeathRecord {
  steamId: string;
  team: "CT" | "T";
  timestamp: number;
}

interface EventAccumulator {
  score: number;
  lastDecayAt: number;
  topEventType: ObserverQueueItem["eventType"];
}

interface AmmoRecord {
  weaponName: string;
  ammoClip: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface PositionSample {
  pos: Vec3;
  at: number;
}

type BumpFn = (steamId: string, amount: number, type: ObserverQueueItem["eventType"]) => void;

let latestScores: ObserverQueueItem[] = [];
let recentDeaths: DeathRecord[] = [];
// Kept separate (rather than one shared accumulator) specifically so
// ENGAGING_CAP can bound just the shots-fired contribution — kills are
// already naturally bounded (at most 5 round_kills, headshot/trade/clutch
// bonuses all capped by real game state), so they don't need a ceiling.
let killEventScores = new Map<string, EventAccumulator>();
let engagingEventScores = new Map<string, EventAccumulator>();
let lastAmmoByPlayer = new Map<string, AmmoRecord>();
let lastPositions = new Map<string, PositionSample>();
let latestAliveSteamIds = new Set<string>();
let lastBroadcastAt = 0;
let lastTickShooters: string[] = [];

/** Current ranked list — recomputed every tick in processObserverEvents, not consumed/removed by auto-switch. */
export function getObserverQueue(): ObserverQueueItem[] {
  return latestScores;
}

/**
 * A player missing from the ranked list is ambiguous on its own — it could
 * mean they died, or just that they're alive but haven't done anything
 * scoreworthy (computeRankedScores drops near-zero totals). auto-switch.ts
 * needs to tell those apart: a dead current player should be cut away from
 * immediately, but a merely-boring-but-alive one should still go through
 * the normal margin/dwell hysteresis so the camera doesn't thrash.
 */
export function isPlayerAlive(steamId: string): boolean {
  return latestAliveSteamIds.has(steamId);
}

/**
 * Whoever's ammo_clip dropped on the tick just processed — used by
 * cinematic/scheduler.ts to redirect the bomb-plant cam to whoever just
 * opened fire on the planter (see maybeRedirectToShooterDuringBombPlant),
 * independent of and in addition to the decaying ENGAGING score these same
 * shots feed into computeRankedScores.
 */
export function getLastTickShooters(): string[] {
  return lastTickShooters;
}

export function resetObserverState(): void {
  latestScores = [];
  recentDeaths = [];
  killEventScores = new Map();
  engagingEventScores = new Map();
  lastAmmoByPlayer = new Map();
  lastPositions = new Map();
  latestAliveSteamIds = new Set();
  lastBroadcastAt = 0;
  lastTickShooters = [];
}

/**
 * Section 5 — Smart Auto Observer. Detects discrete events (kills, shots
 * fired) into decaying score boosts, folds in situational conditions
 * (clutch, contested defuse, proximity, flank potential, holding against a
 * push) recomputed fresh every tick, and republishes the full ranked list
 * for auto-switch.ts to act on.
 * Broadcasts to the admin UI are throttled to BROADCAST_MIN_INTERVAL_MS
 * (except right after a discrete event, for responsiveness) since
 * situational scores can shift a little on every single tick and there's
 * no need to push that at full GSI frequency.
 */
export function processObserverEvents(events: NormalizedEvent[], current: GsiPayload, enabled: boolean): void {
  if (!enabled) {
    lastTickShooters = [];
    return;
  }

  const now = Date.now();
  let hadDiscreteEvent = false;

  for (const event of events) {
    if (event.type === "round_start") {
      resetObserverState();
    }
    if (event.type === "kill") {
      handleKill(event as KillEvent, current, now);
      hadDiscreteEvent = true;
    }
  }

  const shooters = updateEngagingScores(current, now);
  lastTickShooters = shooters;
  latestScores = computeRankedScores(current, now);

  if (hadDiscreteEvent || shooters.length > 0 || now - lastBroadcastAt >= BROADCAST_MIN_INTERVAL_MS) {
    lastBroadcastAt = now;
    broadcast({ kind: "observer_queue_updated", queue: latestScores });
  }
}

function decayedScore(map: Map<string, EventAccumulator>, steamId: string, now: number, halfLifeMs: number): number {
  const acc = map.get(steamId);
  if (!acc) return 0;
  const halfLives = (now - acc.lastDecayAt) / halfLifeMs;
  return acc.score * Math.pow(0.5, halfLives);
}

function accumulateScore(
  map: Map<string, EventAccumulator>,
  steamId: string,
  amount: number,
  eventType: ObserverQueueItem["eventType"],
  now: number,
  halfLifeMs: number
): void {
  const current = decayedScore(map, steamId, now, halfLifeMs);
  map.set(steamId, { score: current + amount, lastDecayAt: now, topEventType: eventType });
}

function parsePosition(raw: string | undefined): Vec3 | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  const [x, y, z] = parts as [number, number, number];
  return { x, y, z };
}

function distance3d(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Units/sec since the last tick's recorded position for this player. The
 * only piece of position *history* this file keeps — everything else is
 * purely situational (recomputed fresh with no memory) — because
 * distinguishing "genuinely running together" from "just happen to be
 * standing near each other" needs actual movement, not just proximity.
 * Returns 0 (rather than a misleadingly huge number) across a stale or
 * unusually long gap, e.g. right after round_start resets the map.
 */
function playerSpeed(steamId: string, pos: Vec3, now: number): number {
  const prev = lastPositions.get(steamId);
  lastPositions.set(steamId, { pos, at: now });
  if (!prev) return 0;
  const dtSeconds = (now - prev.at) / 1000;
  if (dtSeconds <= 0 || dtSeconds > 2) return 0;
  return distance3d(prev.pos, pos) / dtSeconds;
}

/** True while `player`'s currently-held weapon is a sniper rifle (AWP/SSG08/Scout). */
function hasActiveSniper(player: GsiPlayer): boolean {
  return Object.values(player.weapons ?? {}).some((w) => w.state === "active" && w.type === "SniperRifle");
}

/** baseRange, extended to SNIPER_RANGE_UNITS if any of the given players is currently holding a sniper rifle. */
function rangeUnitsFor(baseRange: number, ...players: GsiPlayer[]): number {
  return players.some(hasActiveSniper) ? Math.max(baseRange, SNIPER_RANGE_UNITS) : baseRange;
}

function countAlive(allplayers: Record<string, GsiPlayer>, team: "CT" | "T"): number {
  return Object.values(allplayers).filter((p) => p.team === team && (p.state?.health ?? 0) > 0).length;
}

/**
 * 0 (no alive enemy currently in `player`'s view) to 1 (an in-view enemy is
 * right on top of them) — same falloff shape as bumpProximity, but only
 * against enemies within `player`'s forward view cone (isFacingToward's
 * default, wide awareness cone — this isn't an aim check). An enemy
 * standing right behind them doesn't count, on purpose: see decayHalfLifeFor
 * for why that distinction is exactly the point here.
 */
function nearestEnemyClosenessInView(player: GsiPlayer, allplayers: Record<string, GsiPlayer>): number {
  const pos = parsePosition(player.position);
  if (!pos) return 0;

  const enemyTeam: "CT" | "T" = player.team === "CT" ? "T" : "CT";
  const range = rangeUnitsFor(PROXIMITY_RANGE_UNITS, player);
  let closest = 0;
  for (const other of Object.values(allplayers)) {
    if (other.team !== enemyTeam || (other.state?.health ?? 0) <= 0) continue;
    const otherPos = parsePosition(other.position);
    if (!otherPos) continue;
    if (!isFacingToward(player, pos, otherPos)) continue;
    const closeness = 1 - distance3d(pos, otherPos) / range;
    if (closeness > closest) closest = closeness;
  }
  return Math.min(1, closest);
}

/** Interpolates from EVENT_SCORE_HALF_LIFE_MS (closeness 0) to EVENT_SCORE_HALF_LIFE_NEAR_ENEMY_MS (closeness 1). */
function halfLifeForCloseness(closeness: number): number {
  return EVENT_SCORE_HALF_LIFE_MS + closeness * (EVENT_SCORE_HALF_LIFE_NEAR_ENEMY_MS - EVENT_SCORE_HALF_LIFE_MS);
}

/**
 * How slowly `player`'s decaying kill/engaging score fades right now.
 * Looking toward an enemy who's still alive means the moment probably
 * isn't actually over, so it decays slower the closer that in-view enemy
 * is (up to EVENT_SCORE_HALF_LIFE_NEAR_ENEMY_MS). Looking somewhere with no
 * enemy in view at all — even one standing right behind them — means
 * they've moved on, so it decays *faster* than the plain baseline instead
 * (EVENT_SCORE_HALF_LIFE_NO_ENEMY_IN_SIGHT_MS). Recomputed fresh on every
 * read rather than tracked continuously — like the situational scores
 * below, it reflects *current* facing/proximity, so the effective rate can
 * shift tick to tick as a player turns or an enemy closes in.
 */
function decayHalfLifeFor(player: GsiPlayer, allplayers: Record<string, GsiPlayer>): number {
  const closenessInView = nearestEnemyClosenessInView(player, allplayers);
  if (closenessInView <= 0) return EVENT_SCORE_HALF_LIFE_NO_ENEMY_IN_SIGHT_MS;
  return halfLifeForCloseness(closenessInView);
}

/**
 * Detects a shot as a drop in the active weapon's ammo_clip since the last
 * tick, and adds a small decaying boost rather than the old fixed-value,
 * cooldown-gated one-shot event. Sustained fire naturally keeps the score
 * elevated (each shot adds more before earlier ones have fully decayed);
 * it fades on its own a few seconds after they stop shooting (faster still
 * if no enemy is nearby — see decayHalfLifeFor). A weapon switch just
 * re-baselines the tracked ammo count rather than counting as a shot.
 * Returns the steamIds of everyone whose ammo_clip dropped this tick — see
 * getLastTickShooters.
 */
function updateEngagingScores(current: GsiPayload, now: number): string[] {
  const allplayers = current.allplayers ?? {};
  const shooters: string[] = [];

  for (const [steamId, player] of Object.entries(allplayers)) {
    const alive = (player.state?.health ?? 0) > 0;
    if (!alive) {
      lastAmmoByPlayer.delete(steamId);
      continue;
    }

    const activeWeapon = Object.values(player.weapons ?? {}).find((w) => w.state === "active");
    if (!activeWeapon || activeWeapon.ammo_clip === undefined) continue;

    const prev = lastAmmoByPlayer.get(steamId);
    const sameWeapon = prev?.weaponName === activeWeapon.name;
    const shotFired = sameWeapon && activeWeapon.ammo_clip < prev.ammoClip;

    lastAmmoByPlayer.set(steamId, { weaponName: activeWeapon.name, ammoClip: activeWeapon.ammo_clip });

    if (shotFired) {
      const boost = ENGAGING_SHOT_BOOST + (isShootingTowardEnemy(player, allplayers) ? ENGAGING_SHOOTING_AT_ENEMY_BONUS : 0);
      accumulateScore(engagingEventScores, steamId, boost, "ENGAGING", now, decayHalfLifeFor(player, allplayers));
      shooters.push(steamId);
    }
  }

  return shooters;
}

function handleKill(kill: KillEvent, current: GsiPayload, now: number): void {
  const allplayers = current.allplayers ?? {};
  if (!kill.attackerSteamId) return;
  const attacker = allplayers[kill.attackerSteamId];
  if (!attacker) return;

  const attackerTeam = attacker.team;
  const enemyTeam: "CT" | "T" = attackerTeam === "CT" ? "T" : "CT";
  const aliveOnAttackerTeam = countAlive(allplayers, attackerTeam);
  const aliveOnEnemyTeam = countAlive(allplayers, enemyTeam);
  const attackerRoundKills = attacker.state?.round_kills ?? 0;

  let eventType: ObserverQueueItem["eventType"] = "DUEL";
  let amount = KILL_BASE + (kill.headshot ? HEADSHOT_BONUS : 0);

  if (attackerRoundKills >= 2) {
    eventType = "MULTI_KILL";
    amount += attackerRoundKills * MULTI_KILL_BONUS_PER_KILL;
  }

  if (aliveOnAttackerTeam === 1 && aliveOnEnemyTeam >= 1) {
    eventType = "CLUTCH";
    amount += CLUTCH_WIN_BASE_BONUS + aliveOnEnemyTeam * CLUTCH_WIN_BONUS_PER_ENEMY;
  }

  const victim = kill.victimSteamId ? allplayers[kill.victimSteamId] : undefined;
  if (victim) {
    const avengedTeammate = recentDeaths.find(
      (d) => d.team === attackerTeam && d.steamId !== kill.attackerSteamId && kill.timestamp - d.timestamp < TRADE_WINDOW_MS
    );
    if (avengedTeammate && eventType === "DUEL") {
      eventType = "TRADE";
      amount += TRADE_BONUS;
    }

    recentDeaths.push({ steamId: kill.victimSteamId!, team: victim.team, timestamp: kill.timestamp });
    recentDeaths = recentDeaths.filter((d) => kill.timestamp - d.timestamp < RECENT_DEATH_WINDOW_MS);
  }

  accumulateScore(killEventScores, kill.attackerSteamId, amount, eventType, now, decayHalfLifeFor(attacker, allplayers));
}

function bumpClutch(team: "CT" | "T", aliveOnTeam: number, aliveOnEnemyTeam: number, allplayers: Record<string, GsiPlayer>, bump: BumpFn): void {
  if (aliveOnTeam !== 1 || aliveOnEnemyTeam < 1) return;
  const survivor = Object.entries(allplayers).find(([, p]) => p.team === team && (p.state?.health ?? 0) > 0);
  if (!survivor) return;
  const [steamId] = survivor;
  bump(steamId, CLUTCH_SITUATIONAL_BASE + aliveOnEnemyTeam * CLUTCH_SITUATIONAL_PER_ENEMY, "CLUTCH");
}

/**
 * Adds a smooth falloff contribution to both players in a CT/T pair based
 * purely on distance — no threshold, no transition detection, no cooldown;
 * it's naturally continuous and naturally reaches zero as they move apart.
 * GSI has no map geometry to ray-cast against, so even with position and
 * view direction there's no way to know a wall is between them — this
 * stays capped low (PROXIMITY_MAX) accordingly. bumpFlankPotential below
 * layers facing direction on top of the same distance data for a much
 * stronger (if still wall-blind) signal.
 */
function bumpProximity(alivePlayers: [string, GsiPlayer][], bump: BumpFn): void {
  const ctPlayers = alivePlayers.filter(([, p]) => p.team === "CT");
  const tPlayers = alivePlayers.filter(([, p]) => p.team === "T");

  for (const [ctId, ctPlayer] of ctPlayers) {
    const ctPos = parsePosition(ctPlayer.position);
    if (!ctPos) continue;

    for (const [tId, tPlayer] of tPlayers) {
      const tPos = parsePosition(tPlayer.position);
      if (!tPos) continue;

      const range = rangeUnitsFor(PROXIMITY_RANGE_UNITS, ctPlayer, tPlayer);
      const closeness = 1 - distance3d(ctPos, tPos) / range;
      if (closeness <= 0) continue;

      const amount = PROXIMITY_MAX * Math.min(1, closeness);
      bump(ctId, amount, "PROXIMITY");
      bump(tId, amount, "PROXIMITY");
    }
  }
}

// Tighter than PROXIMITY_RANGE_UNITS — flank potential means being close
// enough to actually press the angle, not just generally on that side of
// the map.
const FLANK_RANGE_UNITS = 1000;
// Cosine of roughly a ±60° cone around a player's `forward` vector. CS2's
// actual FOV is wider than this, so crossing this threshold reads as
// "generally facing that way," not "aimed precisely at them" — deliberately
// generous since the goal is an awareness proxy, not an aim-assist check.
const FLANK_VIEW_COS_THRESHOLD = 0.5;
// Comparable to a real duel-tier score (ENGAGING_CAP is 45) so a genuine
// unnoticed angle stands out over ambient proximity/decay noise without
// outweighing an actual live exchange.
const FLANK_POTENTIAL_MAX = 45;
// Cosine of roughly a ±32° cone — much tighter than FLANK_VIEW_COS_THRESHOLD,
// since this checks whether a shot was actually aimed toward an enemy, not
// just "facing their general direction." Loose enough to tolerate recoil
// spread and a tick of position/forward lag, tight enough that spraying a
// wall 90° off from an enemy doesn't count.
const SHOOTING_AT_ENEMY_COS_THRESHOLD = 0.85;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 | undefined {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (length === 0) return undefined;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * True if `looker` (standing at `lookerPos`) is facing toward `targetPos`
 * within `cosThreshold` of dead-on. GSI's `forward` is a normalized
 * view-direction vector present for every player while spectating (see the
 * "Every player has a single continuous score" doc comment above) — dotted
 * against the direction to the target. Defaults to
 * FLANK_VIEW_COS_THRESHOLD's wide "generally aware of that direction" cone;
 * isShootingTowardEnemy passes the tighter SHOOTING_AT_ENEMY_COS_THRESHOLD
 * instead when it needs something closer to an actual aim check.
 */
function isFacingToward(looker: GsiPlayer, lookerPos: Vec3, targetPos: Vec3, cosThreshold = FLANK_VIEW_COS_THRESHOLD): boolean {
  const forward = parsePosition(looker.forward);
  if (!forward) return false;
  const toTarget = normalize({ x: targetPos.x - lookerPos.x, y: targetPos.y - lookerPos.y, z: targetPos.z - lookerPos.z });
  if (!toTarget) return false;
  return dot(forward, toTarget) >= cosThreshold;
}

/**
 * True if `player` currently has an alive enemy within PROXIMITY_RANGE_UNITS
 * that they're roughly aimed toward — the tighter-cone counterpart to
 * isFacingToward's general awareness check, used to tell an actual exchange
 * apart from firing with nobody in the crosshair (see
 * ENGAGING_SHOOTING_AT_ENEMY_BONUS).
 */
function isShootingTowardEnemy(player: GsiPlayer, allplayers: Record<string, GsiPlayer>): boolean {
  const pos = parsePosition(player.position);
  if (!pos) return false;

  const enemyTeam: "CT" | "T" = player.team === "CT" ? "T" : "CT";
  const range = rangeUnitsFor(PROXIMITY_RANGE_UNITS, player);
  for (const other of Object.values(allplayers)) {
    if (other.team !== enemyTeam || (other.state?.health ?? 0) <= 0) continue;
    const otherPos = parsePosition(other.position);
    if (!otherPos) continue;
    if (distance3d(pos, otherPos) > range) continue;
    if (isFacingToward(player, pos, otherPos, SHOOTING_AT_ENEMY_COS_THRESHOLD)) return true;
  }
  return false;
}

/**
 * A player has flank potential against a specific enemy when they're
 * within FLANK_RANGE_UNITS, facing roughly toward that enemy, and the
 * enemy is *not* facing back toward them — "I can see where they are and
 * they don't know I'm here." Only the single strongest (closest)
 * qualifying pairing counts per player rather than summing across every
 * enemy that qualifies, so standing near a whole unaware group (like a
 * stacked bomb-site push) doesn't rack up an unbounded score just from
 * headcount — one good angle is one good angle regardless of how many
 * targets are on it.
 */
function bumpFlankPotential(alivePlayers: [string, GsiPlayer][], bump: BumpFn): void {
  const withPos = alivePlayers
    .map(([steamId, player]) => ({ steamId, player, pos: parsePosition(player.position) }))
    .filter((p): p is { steamId: string; player: GsiPlayer; pos: Vec3 } => p.pos !== undefined);

  const ctPlayers = withPos.filter((p) => p.player.team === "CT");
  const tPlayers = withPos.filter((p) => p.player.team === "T");

  const best = new Map<string, number>();
  const consider = (steamId: string, amount: number) => {
    if (amount > (best.get(steamId) ?? 0)) best.set(steamId, amount);
  };

  for (const a of ctPlayers) {
    for (const b of tPlayers) {
      const range = rangeUnitsFor(FLANK_RANGE_UNITS, a.player, b.player);
      const closeness = 1 - distance3d(a.pos, b.pos) / range;
      if (closeness <= 0) continue;

      const aFacingB = isFacingToward(a.player, a.pos, b.pos);
      const bFacingA = isFacingToward(b.player, b.pos, a.pos);

      if (aFacingB && !bFacingA) consider(a.steamId, FLANK_POTENTIAL_MAX * closeness);
      if (bFacingA && !aFacingB) consider(b.steamId, FLANK_POTENTIAL_MAX * closeness);
    }
  }

  for (const [steamId, amount] of best) {
    bump(steamId, amount, "FLANK_POTENTIAL");
  }
}

/**
 * Returns the steamIds of teammates currently moving together as a group:
 * each returned player has at least STACK_MIN_PLAYERS-1 other teammates
 * within STACK_RADIUS_UNITS who are *also* moving at STACK_MIN_SPEED_UPS
 * or faster. Requiring actual movement (not just proximity) is what
 * distinguishes a genuine coordinated push from several teammates who
 * simply happen to be holding nearby default positions.
 */
function computeStackedGroups(teamPlayers: [string, GsiPlayer][], now: number): Set<string> {
  const moving = teamPlayers
    .map(([steamId, player]) => {
      const pos = parsePosition(player.position);
      if (!pos) return null;
      return { steamId, pos, speed: playerSpeed(steamId, pos, now) };
    })
    .filter((p): p is { steamId: string; pos: Vec3; speed: number } => p !== null && p.speed >= STACK_MIN_SPEED_UPS);

  const stacked = new Set<string>();
  for (const p of moving) {
    const nearbyMovingTeammates = moving.filter((o) => o.steamId !== p.steamId && distance3d(p.pos, o.pos) <= STACK_RADIUS_UNITS);
    if (nearbyMovingTeammates.length >= STACK_MIN_PLAYERS - 1) {
      stacked.add(p.steamId);
    }
  }
  return stacked;
}

/**
 * When a detected T stack (bumpStacks' tStacked) is within
 * PUSH_TARGET_RANGE_UNITS of an alive CT who's facing roughly toward the
 * nearest one, that CT gets bumped — they're not just near the push,
 * they're watching it arrive. A CT who isn't looking that way doesn't
 * count: GSI can't confirm they've actually noticed anything, so this
 * stays consistent with isFacingToward's awareness-cone semantics
 * elsewhere (see bumpFlankPotential). Takes the already-computed tStacked
 * set rather than recomputing it, since computeStackedGroups mutates
 * position history as a side effect (see playerSpeed) and calling it twice
 * for the same players in the same tick would read back their own
 * just-updated position as "previous," always reporting zero speed.
 */
function bumpPushTarget(tStacked: Set<string>, alivePlayers: [string, GsiPlayer][], bump: BumpFn): void {
  if (tStacked.size === 0) return;

  const stackedTs = alivePlayers.filter(([steamId]) => tStacked.has(steamId));
  const ctPlayers = alivePlayers.filter(([, p]) => p.team === "CT");

  for (const [ctId, ctPlayer] of ctPlayers) {
    const ctPos = parsePosition(ctPlayer.position);
    if (!ctPos) continue;

    const range = rangeUnitsFor(PUSH_TARGET_RANGE_UNITS, ctPlayer);
    let nearest: { pos: Vec3; distance: number } | null = null;
    for (const [, tPlayer] of stackedTs) {
      const tPos = parsePosition(tPlayer.position);
      if (!tPos) continue;
      const distance = distance3d(ctPos, tPos);
      if (distance > range) continue;
      if (!nearest || distance < nearest.distance) nearest = { pos: tPos, distance };
    }
    if (!nearest) continue;
    if (!isFacingToward(ctPlayer, ctPos, nearest.pos)) continue;

    bump(ctId, PUSH_TARGET_SITUATIONAL, "PUSH_TARGET");
  }
}

/**
 * T's stacked while still carrying the bomb (not yet planting — that's
 * BOMB_SITUATIONAL) usually means a coordinated execute is under way, so
 * this features the bomb carrier specifically. CT's stacked have no
 * single natural "carrier" to point at — the group movement itself (a
 * rotate, a retake forming up) is the signal, so every player in the pack
 * gets a share of it. bumpPushTarget separately features whichever CT is
 * actually facing the incoming T stack.
 */
function bumpStacks(current: GsiPayload, alivePlayers: [string, GsiPlayer][], now: number, bump: BumpFn): void {
  const tStacked = computeStackedGroups(
    alivePlayers.filter(([, p]) => p.team === "T"),
    now
  );
  if (current.bomb?.state === "carried" && current.bomb.player && tStacked.has(current.bomb.player)) {
    bump(current.bomb.player, BOMB_STACK_SITUATIONAL, "BOMB_STACK");
  }
  bumpPushTarget(tStacked, alivePlayers, bump);

  const ctStacked = computeStackedGroups(
    alivePlayers.filter(([, p]) => p.team === "CT"),
    now
  );
  for (const steamId of ctStacked) {
    bump(steamId, CT_STACK_SITUATIONAL, "CT_STACK");
  }
}

/**
 * While a CT is defusing, whoever's actually worth watching depends on
 * whether the defuse can still be stopped. A fully-dead enemy team means
 * an uncontested defuse — nothing left to happen, so this bumps nobody and
 * the cinematic bomb-defuse shot takes over instead (see
 * cinematic/scheduler.ts's maybeShowBombDefuseShot). If the T side still
 * has anyone alive, though, *they're* the interesting ones: the defuser
 * doing nothing but holding a key is a lot less watchable than whether a T
 * makes it back in time to stop them, so every alive T gets bumped instead
 * of the defuser.
 */
function bumpBombDefuse(current: GsiPayload, allplayers: Record<string, GsiPlayer>, bump: BumpFn): void {
  if (current.bomb?.state !== "defusing" || !current.bomb.player) return;
  const defuser = allplayers[current.bomb.player];
  if (!defuser) return;

  const enemyTeam: "CT" | "T" = defuser.team === "CT" ? "T" : "CT";
  for (const [steamId, player] of Object.entries(allplayers)) {
    if (player.team === enemyTeam && (player.state?.health ?? 0) > 0) {
      bump(steamId, BOMB_SITUATIONAL, "BOMB_CONTEST");
    }
  }
}

/**
 * Rebuilds the full ranked list from scratch every tick: each player's
 * total is their decaying event score plus whatever situational
 * conditions are true for them right now. The eventType on each returned
 * item is whichever single contribution is currently largest for that
 * player — purely for display (the admin UI's "reason" label) and doesn't
 * affect the total or the ranking.
 */
function computeRankedScores(current: GsiPayload, now: number): ObserverQueueItem[] {
  const allplayers = current.allplayers ?? {};
  const alivePlayers = Object.entries(allplayers).filter(([, p]) => (p.state?.health ?? 0) > 0);
  latestAliveSteamIds = new Set(alivePlayers.map(([steamId]) => steamId));

  const totals = new Map<string, number>();
  const topContribution = new Map<string, { type: ObserverQueueItem["eventType"]; amount: number }>();

  const bump: BumpFn = (steamId, amount, type) => {
    if (amount <= 0) return;
    totals.set(steamId, (totals.get(steamId) ?? 0) + amount);
    const top = topContribution.get(steamId);
    if (!top || amount > top.amount) topContribution.set(steamId, { type, amount });
  };

  for (const [steamId, player] of alivePlayers) {
    const halfLifeMs = decayHalfLifeFor(player, allplayers);

    const killDecayed = decayedScore(killEventScores, steamId, now, halfLifeMs);
    const killAcc = killEventScores.get(steamId);
    if (killDecayed > 0.5 && killAcc) bump(steamId, killDecayed, killAcc.topEventType);

    // Capped regardless of how much has accumulated — see ENGAGING_CAP.
    const engagingDecayed = Math.min(decayedScore(engagingEventScores, steamId, now, halfLifeMs), ENGAGING_CAP);
    if (engagingDecayed > 0.5) bump(steamId, engagingDecayed, "ENGAGING");
  }

  // Planting is never scored here — it's a cinematic establishing-shot
  // trigger instead (see cinematic/scheduler.ts's maybeShowBombPlantShot,
  // fired on bomb_planting), so the planter's own priority never fights
  // that shot for the camera. Defusing gets the same treatment, but only
  // once the enemy team is fully dead — with nobody left to contest it,
  // maybeShowBombDefuseShot takes the cinematic shot instead (see
  // gsi/listener.ts's bomb_defusing handling), so the reactive priority
  // doesn't need to fight it for the camera. While enemies are still alive,
  // bumpBombDefuse below keeps the camera on *them* instead of the
  // defuser — the defuse itself is a static non-event until someone
  // actually stops it, and watching for that is more useful than watching
  // the defuser wait.
  bumpClutch("CT", countAlive(allplayers, "CT"), countAlive(allplayers, "T"), allplayers, bump);
  bumpClutch("T", countAlive(allplayers, "T"), countAlive(allplayers, "CT"), allplayers, bump);
  bumpProximity(alivePlayers, bump);
  bumpFlankPotential(alivePlayers, bump);
  bumpStacks(current, alivePlayers, now, bump);
  bumpBombDefuse(current, allplayers, bump);

  const items: ObserverQueueItem[] = [];
  for (const [steamId, total] of totals) {
    if (total < 1) continue;
    const player = allplayers[steamId];
    if (!player) continue;
    items.push({
      playerSteamId: steamId,
      playerName: player.name,
      side: player.team,
      eventType: topContribution.get(steamId)?.type ?? "DUEL",
      priority: Math.round(total),
      createdAt: new Date(now).toISOString(),
    });
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, QUEUE_LIMIT);
}
