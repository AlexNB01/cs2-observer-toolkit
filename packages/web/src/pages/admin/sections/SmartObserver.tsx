import { useEffect, useState } from "react";
import type { CinematicShot, ObserverQueueItem, ObserverTuning } from "@cs2hud/shared";
import { DEFAULT_OBSERVER_TUNING, RADAR_CALIBRATION } from "@cs2hud/shared";
import { Card, NumberField, Row, Toggle } from "../../../components/ui.js";
import { useHudSettings } from "../../../lib/useHudSettings.js";
import { useHudSocket } from "../../../lib/ws-client.js";
import { api } from "../../../lib/api-client.js";
import { desktopBridge } from "../../../lib/desktop-bridge.js";

const EVENT_LABEL: Record<ObserverQueueItem["eventType"], string> = {
  CLUTCH: "Clutch",
  TRADE: "Trade",
  MULTI_KILL: "Multi-kill",
  DUEL: "Duel",
  BOMB_CONTEST: "Contesting defuse",
  ENGAGING: "Engaging",
  PROXIMITY: "Close proximity",
  FLANK_POTENTIAL: "Unnoticed angle",
  BOMB_STACK: "Stacked with bomb",
  CT_STACK: "CT rotate/stack",
  PUSH_TARGET: "Holding against a push",
};

// "poi" (bomb plant / quiet moment) still exists as a slot value — the
// triggers that would use it are implemented but hidden/disabled for now
// (see gsi/listener.ts) — so it's kept here for type completeness but
// left out of the Type dropdown below.
const SLOT_LABEL: Record<CinematicShot["slot"], string> = {
  ct: "CT spawn (freezetime)",
  t: "T spawn (freezetime)",
  poi: "Point of interest",
};

const TRIGGER_LABEL: Record<"freezetime" | "bomb_plant" | "bomb_defuse" | "quiet_moment" | "manual", string> = {
  freezetime: "Freezetime",
  bomb_plant: "Bomb plant",
  bomb_defuse: "Uncontested defuse",
  quiet_moment: "Quiet moment",
  manual: "Manual",
};

const MAPS = Object.keys(RADAR_CALIBRATION).sort();

function TuningRow(props: {
  label: string;
  hint?: string;
  tuning: ObserverTuning;
  field: keyof ObserverTuning;
  onChange: (patch: Partial<ObserverTuning>) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <Row label={props.label} hint={props.hint}>
      <NumberField
        value={props.tuning[props.field]}
        step={props.step}
        min={props.min}
        max={props.max}
        onChange={(v) => props.onChange({ [props.field]: v } as Partial<ObserverTuning>)}
      />
    </Row>
  );
}

export function SmartObserver() {
  const { settings, update } = useHudSettings();
  const [queue, setQueue] = useState<ObserverQueueItem[]>([]);
  const [allShots, setAllShots] = useState<CinematicShot[]>([]);
  const [selectedMap, setSelectedMap] = useState(MAPS[0] ?? "de_mirage");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelText, setLabelText] = useState("");
  const [slot, setSlot] = useState<CinematicShot["slot"]>("ct");
  const [cinematicMessage, setCinematicMessage] = useState<string | null>(null);
  const [cinematicCfg, setCinematicCfg] = useState<string | null>(null);
  const [lastCue, setLastCue] = useState<string | null>(null);
  const [netconsoleConnected, setNetconsoleConnected] = useState<boolean | null>(null);
  const [manualActive, setManualActive] = useState(false);

  useEffect(() => {
    api.get<ObserverQueueItem[]>("/observer/queue").then(setQueue).catch(console.error);
    function pollStatus() {
      api
        .get<{ connected: boolean }>("/observer/netconsole-status")
        .then((s) => setNetconsoleConnected(s.connected))
        .catch(console.error);
    }
    pollStatus();
    const poll = setInterval(pollStatus, 3000);
    return () => clearInterval(poll);
  }, []);

  function reloadShots() {
    api.get<CinematicShot[]>("/cinematic/shots").then(setAllShots).catch(console.error);
  }
  useEffect(reloadShots, []);

  useHudSocket((message) => {
    if (message.kind === "observer_queue_updated") setQueue(message.queue);
    if (message.kind === "cinematic_cue") {
      setLastCue(
        message.autoTriggered
          ? `${TRIGGER_LABEL[message.trigger]}: ${message.label} — camera moved automatically`
          : `${TRIGGER_LABEL[message.trigger]}: ${message.label} — netconsole not connected, run "${message.execCommand}" yourself (or bind it to a key)`
      );
    }
  });

  function resetForm() {
    setEditingId(null);
    setLabelText("");
    setSlot("ct");
  }

  function startEdit(s: CinematicShot) {
    setEditingId(s.id);
    setLabelText(s.label);
    setSlot(s.slot);
  }

  /** Renames/reslots the shot being edited — its camera path is untouched (see attachCampath for replacing that). */
  async function saveShotEdit() {
    if (!editingId) return;
    setCinematicMessage(null);
    if (!labelText.trim()) {
      setCinematicMessage("Label is required.");
      return;
    }
    await api.put(`/cinematic/shots/${editingId}`, { mapName: selectedMap, label: labelText.trim(), slot });
    setCinematicMessage(`Saved "${labelText.trim()}".`);
    resetForm();
    reloadShots();
  }

  async function deleteShot(id: string) {
    await api.del(`/cinematic/shots/${id}`);
    if (editingId === id) resetForm();
    reloadShots();
  }

  // mirv_campath save's own default target (when no path is given) is
  // wherever cs2.exe lives — game\bin\win64, a sibling of the csgo\cfg
  // folder already configured on the GSI Setup page. HLAE.exe's own
  // install location isn't a reliable guess for this (it's commonly
  // installed somewhere else entirely, e.g. C:\HLAE\), so this derives it
  // from cs2CfgDir instead.
  function campathDefaultDir(): string | undefined {
    const cfgDir = settings?.cs2CfgDir;
    if (!cfgDir) return undefined;
    const gameDir = cfgDir.replace(/[\\/]csgo[\\/]cfg[\\/]?$/i, "");
    if (gameDir === cfgDir) return undefined; // didn't match the expected "...\game\csgo\cfg" shape
    return `${gameDir.replace(/[\\/]+$/, "")}\\bin\\win64`;
  }

  /** Replaces an existing shot's camera path (its reference position/duration are re-derived from the new file). */
  async function attachCampath(id: string) {
    setCinematicMessage(null);
    const file = await desktopBridge?.pickFile(["*"], "HLAE camera path", campathDefaultDir());
    if (!file) return;
    try {
      await api.post(`/cinematic/shots/${id}/campath`, { sourcePath: file });
      setCinematicMessage("Camera path replaced.");
      reloadShots();
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  /** The only way to create a shot — every shot plays a camera path, no coordinates to capture separately. */
  async function loadCampath() {
    setCinematicMessage(null);
    if (!labelText.trim()) {
      setCinematicMessage("Label is required.");
      return;
    }
    const file = await desktopBridge?.pickFile(["*"], "HLAE camera path", campathDefaultDir());
    if (!file) return;
    try {
      await api.post("/cinematic/campath-shots", { mapName: selectedMap, label: labelText.trim(), slot, sourcePath: file });
      setCinematicMessage(`Loaded "${labelText.trim()}".`);
      resetForm();
      reloadShots();
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  async function fireShotNow(id: string) {
    setCinematicMessage(null);
    try {
      await api.post(`/cinematic/shots/${id}/fire`);
      setManualActive(true);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  async function stopManual() {
    await api.post("/cinematic/stop");
    setManualActive(false);
  }

  async function previewCfg() {
    try {
      const result = await api.get<{ content: string }>(`/cinematic/cfg?map=${selectedMap}`);
      setCinematicCfg(result.content);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  async function installCfg() {
    try {
      const result = await api.post<{ path: string }>("/cinematic/cfg/install", { map: selectedMap });
      setCinematicMessage(`cinematic.cfg written to ${result.path}. Bind the printed aliases to keys as a manual fallback.`);
    } catch (e) {
      setCinematicMessage((e as Error).message);
    }
  }

  if (!settings) return <p>Loading…</p>;

  const tuning = settings.observerTuning;
  function updateTuning(patch: Partial<ObserverTuning>) {
    update({ observerTuning: { ...tuning, ...patch } });
  }
  function resetTuning() {
    update({ observerTuning: DEFAULT_OBSERVER_TUNING });
  }

  const shotsForMap = allShots.filter((s) => s.mapName === selectedMap);
  const mapReady = (m: string) => {
    const shots = allShots.filter((s) => s.mapName === m);
    return shots.some((s) => s.slot === "ct") && shots.some((s) => s.slot === "t");
  };
  const readyCount = MAPS.filter(mapReady).length;

  return (
    <>
      <Card
        title="Smart Auto Observer"
        description="Spec section 5 — real-time GSI analysis detects interesting moments and suggests the POV to switch to."
      >
        <Row label="Smart Auto Observer" hint="Scores kills into a priority queue: multi-kills, clutches, trades">
          <Toggle checked={settings.smartObserverEnabled} onChange={(v) => update({ smartObserverEnabled: v })} />
        </Row>

        <Row label="Auto-switch inside CS2" hint="Sends spec_player over CS2's netconsole — targets a player by name directly, no calibration needed">
          <Toggle checked={settings.autoSwitchInsideCs2} onChange={(v) => update({ autoSwitchInsideCs2: v })} />
        </Row>

        {settings.autoSwitchInsideCs2 && (
          <>
            <p style={{ color: netconsoleConnected ? "var(--ok)" : "var(--danger)" }}>
              {netconsoleConnected === null
                ? "Checking netconsole connection…"
                : netconsoleConnected
                  ? "Connected to CS2's netconsole"
                  : "Not connected — launch CS2 with the matching -netconport option below, and make sure it's running"}
            </p>
            <Row label="CS2 netconsole port" hint={`Add "-netconport ${settings.cs2NetconsolePort}" to CS2's Steam launch options (Properties → General → Launch Options) and relaunch CS2 — must match the port here`}>
              <input
                type="number"
                value={settings.cs2NetconsolePort}
                onChange={(e) => update({ cs2NetconsolePort: Number(e.target.value) || 2121 })}
                style={{ width: 90 }}
              />
            </Row>
          </>
        )}

        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Live priority ranking</h3>
        {!settings.smartObserverEnabled ? (
          <p className="empty-state">Enable Smart Auto Observer above to start scoring players.</p>
        ) : queue.length === 0 ? (
          <p className="empty-state">Empty — nobody has a nonzero score right now.</p>
        ) : (
          queue.map((item) => (
            <div className="list-item" key={item.playerSteamId}>
              <span>{item.playerName} ({item.side})</span>
              <span>{EVENT_LABEL[item.eventType]} · priority {item.priority}</span>
            </div>
          ))
        )}

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Advanced tuning</summary>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
            Every number behind the scoring/decay/range/camera-switch behavior above — takes effect on the next GSI tick, no
            restart needed. Leave alone unless something feels off; hover a field's hint for what it does.
          </p>
          <div style={{ marginBottom: 8 }}>
            <button className="secondary" onClick={resetTuning}>Reset to defaults</button>
          </div>

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Camera switching</h3>
          <TuningRow label="Switch margin" hint="A challenger must beat the current player's score by at least this much before the camera cuts to them" tuning={tuning} field="switchMarginScore" onChange={updateTuning} />
          <TuningRow label="Minimum dwell (ms)" hint="Minimum time between camera switches — skipped entirely once the current player has died" tuning={tuning} field="minDwellMs" onChange={updateTuning} step={100} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Score decay</h3>
          <TuningRow label="Baseline half-life (ms)" hint="How fast a kill/engaging score fades by default" tuning={tuning} field="eventScoreHalfLifeMs" onChange={updateTuning} step={100} />
          <TuningRow label="Near-enemy half-life (ms)" hint="Slower decay used while an in-view enemy is right on top of the player — the fight probably isn't over yet" tuning={tuning} field="eventScoreHalfLifeNearEnemyMs" onChange={updateTuning} step={100} />
          <TuningRow label="No-enemy-in-sight half-life (ms)" hint="Faster decay used when no enemy is anywhere in view — they've likely moved on" tuning={tuning} field="eventScoreHalfLifeNoEnemyInSightMs" onChange={updateTuning} step={100} />
          <TuningRow label="Near-enemy bonus max elapsed (ms)" hint="How long after a kill/shot the slower near-enemy decay still applies, even with an enemy still in view" tuning={tuning} field="nearEnemyBonusMaxElapsedMs" onChange={updateTuning} step={100} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Kill scoring</h3>
          <TuningRow label="Kill base" hint="Points for any kill" tuning={tuning} field="killBase" onChange={updateTuning} />
          <TuningRow label="Headshot bonus" tuning={tuning} field="headshotBonus" onChange={updateTuning} />
          <TuningRow label="Multi-kill bonus (per kill)" hint="Extra points per round-kill once the attacker has 2+ this round" tuning={tuning} field="multiKillBonusPerKill" onChange={updateTuning} />
          <TuningRow label="Trade window (ms)" hint="How long after a teammate's death a kill still counts as avenging them" tuning={tuning} field="tradeWindowMs" onChange={updateTuning} step={100} />
          <TuningRow label="Trade bonus" tuning={tuning} field="tradeBonus" onChange={updateTuning} />
          <TuningRow label="Clutch win base bonus" hint="Attacker is the last alive on their team, vs 1+ enemy" tuning={tuning} field="clutchWinBaseBonus" onChange={updateTuning} />
          <TuningRow label="Clutch win bonus (per enemy)" tuning={tuning} field="clutchWinBonusPerEnemy" onChange={updateTuning} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Shots fired (engaging)</h3>
          <TuningRow label="Engaging shot boost" hint="Points per shot fired, whether or not an enemy is in the crosshair" tuning={tuning} field="engagingShotBoost" onChange={updateTuning} />
          <TuningRow label="Shooting-at-enemy bonus" hint="Extra points per shot when roughly aimed at an alive enemy" tuning={tuning} field="engagingShootingAtEnemyBonus" onChange={updateTuning} />
          <TuningRow label="Engaging cap" hint="Ceiling on the decayed engaging contribution — stops sustained fire alone from reaching clutch-tier priority" tuning={tuning} field="engagingCap" onChange={updateTuning} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Situational bonuses</h3>
          <TuningRow label="Clutch situational base" hint="Base priority for the lone survivor in a clutch" tuning={tuning} field="clutchSituationalBase" onChange={updateTuning} />
          <TuningRow label="Clutch situational (per enemy)" tuning={tuning} field="clutchSituationalPerEnemy" onChange={updateTuning} />
          <TuningRow label="Bomb contest" hint="Priority for every alive enemy of whoever is currently defusing" tuning={tuning} field="bombSituational" onChange={updateTuning} />
          <TuningRow label="Proximity max" hint="Highest possible proximity contribution, scaled by closeness" tuning={tuning} field="proximityMax" onChange={updateTuning} />
          <TuningRow label="Proximity range (units)" hint="Distance at which proximity's contribution reaches 0" tuning={tuning} field="proximityRangeUnits" onChange={updateTuning} step={50} />
          <TuningRow label="Sniper range (units)" hint="Range used instead whenever a player is holding an AWP/SSG08/Scout — long sightlines exceed the rifle/CQC-tuned base ranges" tuning={tuning} field="sniperRangeUnits" onChange={updateTuning} step={50} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Team stacks</h3>
          <TuningRow label="Stack min players" hint="Minimum teammates moving together to count as a stack" tuning={tuning} field="stackMinPlayers" onChange={updateTuning} />
          <TuningRow label="Stack radius (units)" hint="How close together counts as one pack" tuning={tuning} field="stackRadiusUnits" onChange={updateTuning} step={50} />
          <TuningRow label="Stack min speed (units/sec)" hint="Minimum speed to count as moving, not just standing near each other — CS2 walk speed is ~130" tuning={tuning} field="stackMinSpeedUps" onChange={updateTuning} step={10} />
          <TuningRow label="Bomb stack bonus" hint="Priority for a T bomb carrier who's part of a moving stack" tuning={tuning} field="bombStackSituational" onChange={updateTuning} />
          <TuningRow label="CT stack bonus" hint="Priority for each CT in a moving stack" tuning={tuning} field="ctStackSituational" onChange={updateTuning} />
          <TuningRow label="Push-target range (units)" hint="Distance within which a defending CT gets credit for watching an incoming T stack" tuning={tuning} field="pushTargetRangeUnits" onChange={updateTuning} step={50} />
          <TuningRow label="Push-target bonus" hint="Priority for a CT who's facing an incoming T stack within range" tuning={tuning} field="pushTargetSituational" onChange={updateTuning} />

          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>Flank &amp; facing detection</h3>
          <TuningRow label="Flank range (units)" hint="Distance within which flank potential (an unnoticed angle on an enemy) can register" tuning={tuning} field="flankRangeUnits" onChange={updateTuning} step={50} />
          <TuningRow label="Flank view cos threshold" hint="Cosine of the general-awareness view cone (flank potential, push-target facing) — 0.87 ≈ ±30°" tuning={tuning} field="flankViewCosThreshold" onChange={updateTuning} step={0.01} min={-1} max={1} />
          <TuningRow label="Flank potential max" hint="Highest possible flank-potential contribution, scaled by closeness" tuning={tuning} field="flankPotentialMax" onChange={updateTuning} />
          <TuningRow label="Shooting-at-enemy cos threshold" hint="Cosine of the tighter cone used to decide whether a shot was actually aimed at an enemy — 0.96 ≈ ±16°" tuning={tuning} field="shootingAtEnemyCosThreshold" onChange={updateTuning} step={0.01} min={-1} max={1} />
        </details>
      </Card>

      <Card
        title="Cinematic camera shots"
        description={`${readyCount}/${MAPS.length} maps have both a CT and T freezetime shot captured.`}
      >
        <Row label="Freezetime shots" hint="Winner's side first, rotates through however many CT/T shots you've captured for the map">
          <Toggle checked={settings.cinematicFreezetimeShotsEnabled} onChange={(v) => update({ cinematicFreezetimeShotsEnabled: v })} />
        </Row>
        {/*
          Bomb-plant/defuse establishing shots and quiet-moment filler shots
          are fully implemented (see cinematic/scheduler.ts) but disabled
          for all users for now — the server hard-codes them off regardless
          of these settings (see gsi/listener.ts). Toggles (and the "poi"
          slot they depend on) hidden here to match; re-add these Rows and
          the "poi" <option> in the Type select below to bring them back.
          <Row label="Bomb plant shots" hint="As planting starts (or, if the enemy team is already fully dead, as defusing starts) cuts to whichever captured shot is nearest">
            <Toggle checked={settings.cinematicBombPlantShotsEnabled} onChange={(v) => update({ cinematicBombPlantShotsEnabled: v })} />
          </Row>
          <Row label="Quiet-moment filler shots" hint="Cuts briefly to a point-of-interest shot (e.g. mid) when players are near it and nothing else is happening">
            <Toggle checked={settings.cinematicQuietMomentShotsEnabled} onChange={(v) => update({ cinematicQuietMomentShotsEnabled: v })} />
          </Row>
        */}

        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          "▶ Fire now" on any shot below cuts to it immediately, live, ignoring the freezetime trigger above — useful for testing a
          camera path against a real match without waiting for the right moment to line up. It stays up until you press Stop.
        </p>
        {manualActive && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--accent)" }}>🎬 Manual shot live</span>
            <button onClick={stopManual}>⏹ Stop</button>
          </div>
        )}

        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          Every shot plays an HLAE <code>mirv_campath</code> file — build the path in-game with HLAE's own campath editor, save it
          (<code>mirv_campath save</code>), then import it with "Load campath" below. Its reference position (used to pick which
          shot is nearest the action) is derived automatically from the path's first keyframe, so there's nothing to capture by
          hand.
        </p>

        <Row label="Map">
          <select value={selectedMap} onChange={(e) => { setSelectedMap(e.target.value); resetForm(); }}>
            {MAPS.map((m) => (
              <option key={m} value={m}>
                {m} {mapReady(m) ? "✓" : ""}
              </option>
            ))}
          </select>
        </Row>

        {shotsForMap.length === 0 ? (
          <p className="empty-state">No shots captured for {selectedMap} yet.</p>
        ) : (
          shotsForMap.map((s) => (
            <div className="list-item" key={s.id}>
              <span>
                {s.label} <small style={{ color: "var(--muted)" }}>({SLOT_LABEL[s.slot]})</small>
                <small style={{ color: "var(--accent)" }}>
                  {" "}
                  · 🎥 {s.campathDurationMs ? `${(s.campathDurationMs / 1000).toFixed(1)}s` : "camera path"}
                </small>
              </span>
              <span>
                <button className="secondary" onClick={() => fireShotNow(s.id)}>▶ Fire now</button>{" "}
                <button className="secondary" onClick={() => startEdit(s)}>Edit</button>{" "}
                <button className="secondary" onClick={() => attachCampath(s.id)} disabled={!desktopBridge}>
                  Replace path
                </button>{" "}
                <button className="secondary" onClick={() => deleteShot(s.id)}>Delete</button>
              </span>
            </div>
          ))
        )}

        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 4px" }}>{editingId ? "Edit shot" : "Add shot"}</h3>
        <Row label="Label" hint='e.g. "CT spawn", "T spawn"'>
          <input type="text" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
        </Row>
        <Row label="Type">
          <select value={slot} onChange={(e) => setSlot(e.target.value as CinematicShot["slot"])}>
            <option value="ct">CT spawn (freezetime)</option>
            <option value="t">T spawn (freezetime)</option>
          </select>
        </Row>

        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {editingId ? (
            <>
              <button onClick={saveShotEdit}>Save changes</button>
              <button className="secondary" onClick={resetForm}>Cancel</button>
            </>
          ) : (
            <button className="secondary" onClick={loadCampath} disabled={!desktopBridge}>
              Load campath…
            </button>
          )}
          <button className="secondary" onClick={previewCfg}>Preview cfg</button>
          <button className="secondary" onClick={installCfg}>Install cinematic.cfg</button>
        </div>
        {!desktopBridge && (
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            Native file picker isn't available outside the desktop app — "Replace path"/"Load campath" need it.
          </p>
        )}
        {cinematicMessage && <p style={{ color: "var(--muted)" }}>{cinematicMessage}</p>}
        {cinematicCfg && (
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0b0d10", padding: 12, borderRadius: 6, marginTop: 8 }}>
            {cinematicCfg}
          </pre>
        )}

        {lastCue && (
          <p style={{ marginTop: 12, color: "var(--accent)" }}>
            📷 Live cue: {lastCue}
          </p>
        )}
      </Card>
    </>
  );
}
