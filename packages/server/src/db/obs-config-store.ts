import { db } from "./client.js";

export interface ObsConfig {
  host: string;
  port: number;
  password: string;
  volume: number;
}

interface ObsConfigRow {
  host: string;
  port: number;
  password: string;
  volume: number;
}

export function readObsConfig(): ObsConfig {
  const row = db.prepare("SELECT host, port, password, volume FROM obs_config WHERE id = 1").get() as unknown as ObsConfigRow;
  return row;
}

export function writeObsConfig(patch: Partial<ObsConfig>): ObsConfig {
  const current = readObsConfig();
  const merged = { ...current, ...patch };
  db.prepare("UPDATE obs_config SET host = ?, port = ?, password = ?, volume = ? WHERE id = 1").run(
    merged.host,
    merged.port,
    merged.password,
    merged.volume
  );
  return merged;
}
