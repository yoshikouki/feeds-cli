import { Database } from "bun:sqlite";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const dbPath = process.argv[2] ?? "./feeds.db";
const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON");

try {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: join(import.meta.dir, "migrations") });
} finally {
  sqlite.close();
}
