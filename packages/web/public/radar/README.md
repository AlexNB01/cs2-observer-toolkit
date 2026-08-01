# Radar images

The minimap (`/minimap`) looks for `de_<mapname>.png` here, e.g. `de_mirage.png`,
`de_dust2.png`.

These are populated with Lexogrine's MIT-licensed radar dataset (see
`LICENSE` in this folder) for all 9 calibrated maps below — sourced from a
local BoltObserv install, which bundles them under that same license.

Coordinate calibration (pos_x/pos_y/scale/rotate — public numeric metadata,
not an asset) is wired up in `packages/shared/src/radar.ts` for:

de_dust2, de_mirage, de_inferno, de_nuke, de_overpass, de_vertigo,
de_ancient, de_anubis, de_train

Without a file here for a given map, the minimap falls back to a plain grid
placeholder so it still renders player dots in roughly the right place.

If a map you use isn't in the calibration list above, add its
`{ posX, posY, scale, rotate }` to `RADAR_CALIBRATION` in
`packages/shared/src/radar.ts` — those values come from the map's overview
resource file.
