import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

/**
 * HLAE saves mirv_campath files wherever the user tells it to (by default,
 * next to cs2.exe — game\bin\win64), which isn't a folder this app manages
 * or can rely on staying put. Imported files are copied here instead, next
 * to the sqlite db, so a captured shot keeps working regardless of what the
 * user does with their original file afterward.
 */
export const CAMPATH_STORAGE_DIR = path.join(path.dirname(env.dbPath), "campaths");

interface CampathKeyframe {
  t: number;
  x: number;
  y: number;
  z: number;
}

/**
 * `t` is the first attribute on a <p> keyframe (e.g. `<p t="512.09" x=...`)
 * — only one space separates it from the tag name, so a naive `<p\s...\s
 * name="` (requiring *two* whitespace gaps) never matches. `\b` finds the
 * attribute-name boundary regardless of how many attributes precede it.
 */
function attr(tagAttrs: string, name: string): number | undefined {
  const m = tagAttrs.match(new RegExp(`\\b${name}="(-?[\\d.]+(?:[eE][-+]?\\d+)?)"`));
  return m ? Number(m[1]) : undefined;
}

function parseCampathKeyframes(xml: string): CampathKeyframe[] {
  const keyframes: CampathKeyframe[] = [];
  for (const m of xml.matchAll(/<p\b([^>]*)\/?>/g)) {
    const t = attr(m[1]!, "t");
    const x = attr(m[1]!, "x");
    const y = attr(m[1]!, "y");
    const z = attr(m[1]!, "z");
    if (t !== undefined && x !== undefined && y !== undefined && z !== undefined) {
      keyframes.push({ t, x, y, z });
    }
  }
  return keyframes;
}

/**
 * Everything derived from a campath file's keyframes at import time:
 *  - `position`: the earliest keyframe's world x/y/z — roughly where the
 *    path starts, which stands in for a manually-captured spec_pos
 *    reference point (see @cs2hud/shared's CinematicShot doc comment) for
 *    bomb-site/quiet-moment nearest-shot matching in cinematic/scheduler.ts.
 *  - `durationMs`: the actual playback length. Campath keyframes carry an
 *    *absolute* curtime (whatever the game clock read when each point was
 *    recorded), not a path-relative offset — see cfg.ts's shotCommand doc
 *    comment on `mirv_campath edit start` — so the length is simply the
 *    span between the earliest and latest keyframe time, regardless of
 *    what those absolute values are.
 * Both are undefined if the file has no parseable keyframes at all.
 */
export function parseCampathInfo(xml: string): { position?: { x: number; y: number; z: number }; durationMs?: number } {
  const keyframes = parseCampathKeyframes(xml);
  if (keyframes.length === 0) return {};
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const spanSeconds = last.t - first.t;
  return {
    position: { x: first.x, y: first.y, z: first.z },
    durationMs: keyframes.length >= 2 && spanSeconds > 0 ? spanSeconds * 1000 : undefined,
  };
}

/**
 * Every imported path is normalized to this length — speeding up a longer
 * recording or slowing down a shorter one uniformly, never skipping or
 * duplicating a keyframe (see rescaleCampathDuration below) — so freezetime
 * CT/T shots stay predictable regardless of how long the original
 * recording session happened to run, rather than occasionally overrunning
 * the server's actual mp_freezetime (see cinematic/scheduler.ts's
 * freezetimeSequenceTimers doc comment for that failure mode).
 */
const TARGET_CAMPATH_DURATION_SECONDS = 8;

/**
 * Uniformly speeds up or slows down a path to last exactly
 * `targetDurationSeconds`, by rescaling every keyframe's time (relative to
 * the earliest one) by the same factor — same technique as HLAE's own
 * `mirv_campath edit duration <value>` (confirmed against
 * advancedfx/afx-doc's docs/commands/AfxHookSource/mirv_campath.md: "Sets a
 * new duration for the path... no interpolation is done", i.e. every
 * keyframe is kept, just retimed). Done here at import time instead of via
 * that live console command so the stored file's *actual* duration always
 * matches campathDurationMs — cinematic/scheduler.ts's timing depends on
 * that being true. Only the `t` attribute changes; position/rotation/fov
 * and the spatial shape of the path are untouched. No-op on a file with
 * fewer than two distinct keyframe times (nothing to rescale).
 */
export function rescaleCampathDuration(xml: string, targetDurationSeconds: number): string {
  const keyframes = parseCampathKeyframes(xml);
  if (keyframes.length < 2) return xml;
  const times = keyframes.map((k) => k.t);
  const minT = Math.min(...times);
  const spanSeconds = Math.max(...times) - minT;
  if (spanSeconds <= 0) return xml;
  const scale = targetDurationSeconds / spanSeconds;

  return xml.replace(/<p\b([^>]*)>/g, (fullMatch, tagAttrs: string) => {
    const t = attr(tagAttrs, "t");
    if (t === undefined) return fullMatch;
    const newT = minT + (t - minT) * scale;
    const newAttrs = tagAttrs.replace(/\bt="-?[\d.]+(?:[eE][-+]?\d+)?"/, `t="${newT.toFixed(6)}"`);
    return `<p${newAttrs}>`;
  });
}

/**
 * Copies a user-picked .campath file into CAMPATH_STORAGE_DIR under a
 * generated name (avoids collisions between shots that reuse the same
 * source filename), rescaled to TARGET_CAMPATH_DURATION_SECONDS, and
 * returns that stored filename plus its parsed position/duration, to
 * persist on the owning CinematicShot row. Rejects a file with no
 * parseable keyframes outright — every shot needs the derived position, so
 * there's nothing useful to save otherwise.
 */
export function importCampathFile(sourcePath: string): { fileName: string; position: { x: number; y: number; z: number }; durationMs?: number } {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }
  const original = fs.readFileSync(sourcePath, "utf-8");
  const content = rescaleCampathDuration(original, TARGET_CAMPATH_DURATION_SECONDS);
  const { position, durationMs } = parseCampathInfo(content);
  if (!position) {
    throw new Error("Couldn't find any keyframes in this file — is it a valid mirv_campath export?");
  }
  fs.mkdirSync(CAMPATH_STORAGE_DIR, { recursive: true });
  const fileName = `${randomUUID()}${path.extname(sourcePath) || ".campath"}`;
  fs.writeFileSync(path.join(CAMPATH_STORAGE_DIR, fileName), content);
  return { fileName, position, durationMs };
}

export function campathFilePath(fileName: string): string {
  return path.join(CAMPATH_STORAGE_DIR, fileName);
}

export function deleteCampathFile(fileName: string): void {
  const target = campathFilePath(fileName);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
