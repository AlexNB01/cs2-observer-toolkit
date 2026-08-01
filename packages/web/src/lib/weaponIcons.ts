/**
 * Weapon icon set in public/icons — filenames match GSI's weapon name
 * exactly once the "weapon_" prefix is stripped (e.g. "weapon_m4a1_silencer"
 * -> "m4a1_silencer.svg"), since both follow the same canonical CS internal
 * naming. Knife skins report distinct names GSI doesn't always expose, so
 * anything starting with "knife" that isn't an exact match falls back to a
 * generic blade icon.
 */
const KNOWN_WEAPON_ICONS = new Set([
  "ak47", "aug", "awp", "bayonet", "bizon", "c4", "cz75a", "deagle", "decoy", "elite",
  "famas", "fiveseven", "flashbang", "g3sg1", "galilar", "glock", "hegrenade", "hkp2000",
  "incgrenade", "knife", "knife_bayonet", "knife_butterfly", "knife_canis", "knife_cord",
  "knife_css", "knife_falchion", "knife_flip", "knife_gut", "knife_gypsy_jackknife",
  "knife_karambit", "knife_m9_bayonet", "knife_outdoor", "knife_push", "knife_skeleton",
  "knife_stiletto", "knife_survival_bowie", "knife_t", "knife_tactical", "knife_ursus",
  "knife_widowmaker", "m249", "m4a1", "m4a1_silencer", "m4a1_silencer_off", "mac10", "mag7",
  "molotov", "mp5sd", "mp7", "mp9", "negev", "nova", "p250", "p90", "revolver", "sawedoff",
  "scar20", "sg556", "smokegrenade", "ssg08", "tec9", "ump45", "usp_silencer",
  "usp_silencer_off", "xm1014", "taser",
]);

export function weaponIconUrl(weaponName: string): string | null {
  const key = weaponName.replace(/^weapon_/, "");
  if (KNOWN_WEAPON_ICONS.has(key)) return `/icons/${key}.svg`;
  if (key.startsWith("knife")) return "/icons/knife.svg";
  return null;
}

export const ICON_HEALTH = "/icons/icon_health_default.svg";
export const ICON_HEALTH_FULL = "/icons/icon_health_full_default.svg";
export const ICON_ARMOR_FULL = "/icons/icon_armor_full_default.svg";
export const ICON_ARMOR_HALF = "/icons/icon_armor_half_default.svg";
export const ICON_ARMOR_HELMET = "/icons/icon_armor_helmet_default.svg";
export const ICON_ARMOR_HALF_HELMET = "/icons/icon_armor_half_helmet_default.svg";
export const ICON_ARMOR_NONE = "/icons/icon_armor_none_default.svg";
export const ICON_BOMB = "/icons/icon_bomb_default.svg";
export const ICON_DEFUSE = "/icons/icon_defuse_default.svg";
export const ICON_TIMER = "/icons/icon_timer_default.svg";
export const ICON_SKULL = "/icons/icon_skull_default.svg";

export function armorIconUrl(armor: number, helmet: boolean): string {
  if (armor <= 0) return ICON_ARMOR_NONE;
  if (armor < 100) return helmet ? ICON_ARMOR_HALF_HELMET : ICON_ARMOR_HALF;
  return helmet ? ICON_ARMOR_HELMET : ICON_ARMOR_FULL;
}
