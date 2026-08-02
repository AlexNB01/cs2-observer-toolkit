import type { GsiFlightGrenade, GsiPayload, GsiPlayer, KillEvent, NormalizedEvent, ObserverQueueItem } from "@cs2hud/shared";
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
 *    (EVENT_SCORE_HALF_LIFE_MS) rather than being shown once and then
 *    vanishing — a kill stays "interesting" for a few seconds afterward,
 *    not zero the instant the camera first cuts to it.
 *  - Situational score: conditions that are true *right now* (clutch,
 *    mid-plant/defuse, near an enemy, on fire, low HP) are recomputed
 *    fresh every tick from the current payload — no history needed, since
 *    they naturally reach zero the moment the condition stops being true.
 * auto-switch.ts picks whoever has the highest total, but only actually
 * switches away from the current player once a challenger clearly beats
 * them (see SWITCH_MARGIN there) — that hysteresis on the switch
 * *decision*, not this scoring, is what stops the camera from thrashing
 * between two players with near-identical scores.
 */
const EVENT_SCORE_HALF_LIFE_MS = 5_000;

const KILL_BASE = 100;
const HEADSHOT_BONUS = 15;
const MULTI_KILL_BONUS_PER_KILL = 25;
const TRADE_BONUS = 30;
const CLUTCH_WIN_BASE_BONUS = 40;
const CLUTCH_WIN_BONUS_PER_ENEMY = 20;
const ENGAGING_SHOT_BOOST = 10;
// Hard ceiling on the engaging (shots-fired) contribution, independent of
// weapon fire rate or magazine size. Without this, a high-RPM/large-mag
// weapon (Negev: ~750rpm, 150-round mag) held on full auto into a wall
// converges to a steady-state score of roughly rate * boost *
// (halfLife/ln2) ≈ 12.5 * 10 * 7.2s ≈ 900 — comfortably clutch-tier —
// just from spraying, with nobody actually being fought. Capping the
// *decayed value* at read time bounds that regardless of rate or
// duration; it can't be raised by firing faster or longer.
const ENGAGING_CAP = 30;

const CLUTCH_SITUATIONAL_BASE = 1000;
const CLUTCH_SITUATIONAL_PER_ENEMY = 10;
const BOMB_SITUATIONAL = 500;
const BURNING_SITUATIONAL = 15;
const PROXIMITY_MAX = 10;
const PROXIMITY_RANGE_UNITS = 1200; // distance at which proximity's contribution reaches 0
const LOW_HP_MAX = 8;

// A "stack": several teammates moving together as a group, rather than
// spread out on separate default spots — usually means a coordinated
// execute/rush (T) or rotate/retake (CT) is about to happen, before
// there's any kill or plant to react to yet.
const STACK_MIN_PLAYERS = 3;
const STACK_RADIUS_UNITS = 600; // how close together counts as "one pack"
const STACK_MIN_SPEED_UPS = 100; // units/sec — CS2 walk speed is ~130, so this filters out "just standing near each other"
const BOMB_STACK_SITUATIONAL = 80; // T's stacked with the bomb still being carried (not yet planting — that's BOMB_SITUATIONAL)
const CT_STACK_SITUATIONAL = 35; // softer signal — CTs grouping up is common and only sometimes means something's about to happen

// An in-flight offensive grenade heading toward the enemy team usually
// means a duel is about to happen wherever it lands — this lets the camera
// already be there when it does, instead of only cutting in reactively
// once a shot's been fired or someone's already dead. Tighter radius than
// PROXIMITY_RANGE_UNITS since this is meant to model a flash/HE's actual
// effective radius, not just "somewhere in the general area." Smoke/decoy
// are weaker tells (denying vision ahead of a push/retake, not a direct
// threat) so they're weighted lower than frag/flash/molotov.
const GRENADE_ANTICIPATION_RANGE_UNITS = 700;
const GRENADE_ANTICIPATION_WEIGHT: Partial<Record<GsiFlightGrenade["type"], number>> = {
  flashbang: 40,
  frag: 40,
  firebomb: 25,
  smoke: 15,
  decoy: 15,
};

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

export function resetObserverState(): void {
  latestScores = [];
  recentDeaths = [];
  killEventScores = new Map();
  engagingEventScores = new Map();
  lastAmmoByPlayer = new Map();
  lastPositions = new Map();
  latestAliveSteamIds = new Set();
  lastBroadcastAt = 0;
}

/**
 * Section 5 — Smart Auto Observer. Detects discrete events (kills, shots
 * fired) into decaying score boosts, folds in situational conditions
 * (clutch, bomb, proximity, in-flight grenades, burning, low HP) recomputed
 * fresh every tick, and republishes the full ranked list for auto-switch.ts
 * to act on.
 * Broadcasts to the admin UI are throttled to BROADCAST_MIN_INTERVAL_MS
 * (except right after a discrete event, for responsiveness) since
 * situational scores can shift a little on every single tick and there's
 * no need to push that at full GSI frequency.
 */
export function processObserverEvents(events: NormalizedEvent[], current: GsiPayload, enabled: boolean): void {
  if (!enabled) return;

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

  const shotFired = updateEngagingScores(current, now);
  latestScores = computeRankedScores(current, now);

  if (hadDiscreteEvent || shotFired || now - lastBroadcastAt >= BROADCAST_MIN_INTERVAL_MS) {
    lastBroadcastAt = now;
    broadcast({ kind: "observer_queue_updated", queue: latestScores });
  }
}

function decayedScore(map: Map<string, EventAccumulator>, steamId: string, now: number): number {
  const acc = map.get(steamId);
  if (!acc) return 0;
  const halfLives = (now - acc.lastDecayAt) / EVENT_SCORE_HALF_LIFE_MS;
  return acc.score * Math.pow(0.5, halfLives);
}

function accumulateScore(
  map: Map<string, EventAccumulator>,
  steamId: string,
  amount: number,
  eventType: ObserverQueueItem["eventType"],
  now: number
): void {
  const current = decayedScore(map, steamId, now);
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

function countAlive(allplayers: Record<string, GsiPlayer>, team: "CT" | "T"): number {
  return Object.values(allplayers).filter((p) => p.team === team && (p.state?.health ?? 0) > 0).length;
}

/**
 * Detects a shot as a drop in the active weapon's ammo_clip since the last
 * tick, and adds a small decaying boost rather than the old fixed-value,
 * cooldown-gated one-shot event. Sustained fire naturally keeps the score
 * elevated (each shot adds more before earlier ones have fully decayed);
 * it fades on its own a few seconds after they stop shooting. A weapon
 * switch just re-baselines the tracked ammo count rather than counting as
 * a shot.
 */
function updateEngagingScores(current: GsiPayload, now: number): boolean {
  const allplayers = current.allplayers ?? {};
  let fired = false;

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
      accumulateScore(engagingEventScores, steamId, ENGAGING_SHOT_BOOST, "ENGAGING", now);
      fired = true;
    }
  }

  return fired;
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

  accumulateScore(killEventScores, kill.attackerSteamId, amount, eventType, now);
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
 * on distance — no threshold, no transition detection, no cooldown; it's
 * naturally continuous and naturally reaches zero as they move apart. GSI
 * has no line-of-sight data, so this stays capped low (PROXIMITY_MAX) —
 * "close" can just mean "on opposite sides of a wall."
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

      const closeness = 1 - distance3d(ctPos, tPos) / PROXIMITY_RANGE_UNITS;
      if (closeness <= 0) continue;

      const amount = PROXIMITY_MAX * Math.min(1, closeness);
      bump(ctId, amount, "PROXIMITY");
      bump(tId, amount, "PROXIMITY");
    }
  }
}

/**
 * Purely situational like bumpProximity — recomputed fresh from whichever
 * grenades are currently in current.grenades, no memory needed, since it
 * naturally disappears the moment the grenade lands/detonates/expires.
 * Only bumps players on the *enemy* team from the thrower — the whole
 * point is flagging who's about to be caught in it, not the thrower
 * themselves.
 */
function bumpGrenadeAnticipation(current: GsiPayload, alivePlayers: [string, GsiPlayer][], bump: BumpFn): void {
  const grenades = current.grenades;
  if (!grenades) return;

  for (const grenade of Object.values(grenades)) {
    if (grenade.type === "inferno") continue;

    const weight = GRENADE_ANTICIPATION_WEIGHT[grenade.type];
    if (!weight) continue;

    const owner = current.allplayers?.[grenade.owner];
    const grenadePos = parsePosition(grenade.position);
    if (!owner || !grenadePos) continue;

    const enemyTeam: "CT" | "T" = owner.team === "CT" ? "T" : "CT";

    for (const [steamId, player] of alivePlayers) {
      if (player.team !== enemyTeam) continue;
      const pos = parsePosition(player.position);
      if (!pos) continue;

      const closeness = 1 - distance3d(grenadePos, pos) / GRENADE_ANTICIPATION_RANGE_UNITS;
      if (closeness <= 0) continue;
      bump(steamId, weight * Math.min(1, closeness), "UTILITY");
    }
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
 * T's stacked while still carrying the bomb (not yet planting — that's
 * BOMB_SITUATIONAL) usually means a coordinated execute is under way, so
 * this features the bomb carrier specifically. CT's stacked have no
 * single natural "carrier" to point at — the group movement itself (a
 * rotate, a retake forming up) is the signal, so every player in the pack
 * gets a share of it.
 */
function bumpStacks(current: GsiPayload, alivePlayers: [string, GsiPlayer][], now: number, bump: BumpFn): void {
  const tStacked = computeStackedGroups(
    alivePlayers.filter(([, p]) => p.team === "T"),
    now
  );
  if (current.bomb?.state === "carried" && current.bomb.player && tStacked.has(current.bomb.player)) {
    bump(current.bomb.player, BOMB_STACK_SITUATIONAL, "BOMB_STACK");
  }

  const ctStacked = computeStackedGroups(
    alivePlayers.filter(([, p]) => p.team === "CT"),
    now
  );
  for (const steamId of ctStacked) {
    bump(steamId, CT_STACK_SITUATIONAL, "CT_STACK");
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
    const killDecayed = decayedScore(killEventScores, steamId, now);
    const killAcc = killEventScores.get(steamId);
    if (killDecayed > 0.5 && killAcc) bump(steamId, killDecayed, killAcc.topEventType);

    // Capped regardless of how much has accumulated — see ENGAGING_CAP.
    const engagingDecayed = Math.min(decayedScore(engagingEventScores, steamId, now), ENGAGING_CAP);
    if (engagingDecayed > 0.5) bump(steamId, engagingDecayed, "ENGAGING");

    const health = player.state?.health ?? 0;
    bump(steamId, ((100 - health) / 100) * LOW_HP_MAX, "LOW_HP");

    if ((player.state?.burning ?? 0) > 0) bump(steamId, BURNING_SITUATIONAL, "BURNING");

    const bombState = current.bomb?.state;
    if ((bombState === "planting" || bombState === "defusing") && current.bomb?.player === steamId) {
      bump(steamId, BOMB_SITUATIONAL, "BOMB");
    }
  }

  bumpClutch("CT", countAlive(allplayers, "CT"), countAlive(allplayers, "T"), allplayers, bump);
  bumpClutch("T", countAlive(allplayers, "T"), countAlive(allplayers, "CT"), allplayers, bump);
  bumpProximity(alivePlayers, bump);
  bumpStacks(current, alivePlayers, now, bump);
  bumpGrenadeAnticipation(current, alivePlayers, bump);

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
