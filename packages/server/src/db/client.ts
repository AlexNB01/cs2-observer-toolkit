import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

/**
 * Uses Node's built-in (experimental) SQLite module instead of a native
 * addon like better-sqlite3, so `npm install` needs no C++ build toolchain
 * on Windows.
 */
export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
