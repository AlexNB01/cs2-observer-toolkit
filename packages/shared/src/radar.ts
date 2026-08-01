export interface RadarCalibration {
  posX: number;
  posY: number;
  scale: number;
  /** CS2's overview "rotate" flag — radar image is rotated 90°. */
  rotate?: 0 | 1;
}

/**
 * World-to-radar-pixel calibration for CS2's recent competitive map pool.
 * pos_x/pos_y/scale/rotate are Valve's own public per-map overview
 * metadata (numeric constants, not a copyrighted asset) — cross-checked
 * against github.com/MurkyYT/cs2-map-icons (auto-extracted from the game
 * depot) on 2026-08-01. The radar *images* are Valve's IP and are
 * deliberately NOT bundled here — see packages/web/public/radar/README.md
 * for how to supply your own, extracted from your own CS2 install.
 */
export const RADAR_CALIBRATION: Record<string, RadarCalibration> = {
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4, rotate: 1 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5 },
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4 },
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  de_train: { posX: -2308, posY: 2078, scale: 4.082077 },
};

/** Valve's overview radar textures are 1024×1024. */
export const RADAR_IMAGE_SIZE_PX = 1024;

/**
 * Projects a GSI world position onto the radar image, normalized to
 * [0,1] on both axes (fractions of the 1024x1024 texture).
 *
 * Known limitations:
 *  - Ignores Z (altitude) — multi-level maps like de_nuke/de_vertigo will
 *    show upper and lower level players stacked on top of each other.
 *  - The rotate=1 case (currently only de_dust2) applies a 90° swap that's
 *    a best-effort guess at Valve's convention; verify visually once you
 *    have a real radar image for that map and adjust if it's off.
 */
export function worldToRadarNormalized(
  worldX: number,
  worldY: number,
  calibration: RadarCalibration
): { xPct: number; yPct: number } {
  let px = (worldX - calibration.posX) / calibration.scale;
  let py = (calibration.posY - worldY) / calibration.scale;

  if (calibration.rotate === 1) {
    const rotatedX = py;
    const rotatedY = RADAR_IMAGE_SIZE_PX - px;
    px = rotatedX;
    py = rotatedY;
  }

  return {
    xPct: clamp01(px / RADAR_IMAGE_SIZE_PX),
    yPct: clamp01(py / RADAR_IMAGE_SIZE_PX),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
