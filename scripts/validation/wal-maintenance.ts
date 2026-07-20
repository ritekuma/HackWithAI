// @module scripts/validation/wal-maintenance.ts — Periodic WAL checkpoint + VACUUM
// Run as cron or before CI: npx tsx scripts/validation/wal-maintenance.ts

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DBS = [
  "events",
  "governance",
  "mission-timeline",
  "mission-checkpoints",
  "decisions",
  "mission-kernel",
];

interface WALHealth {
  db: string;
  sizeBytes: number;
  walSizeBytes: number;
  checkpointed: boolean;
  checkpointDurationMs: number;
  vacuumed: boolean;
  vacuumDurationMs: number;
}

async function main() {
  console.log("[WAL] Starting maintenance...");
  const results: WALHealth[] = [];

  for (const dbName of DBS) {
    const dbPath = path.join("data", `${dbName}.db`);
    if (!fs.existsSync(dbPath)) {
      console.log(`[WAL] ${dbName}: not found, skipping`);
      continue;
    }

    const db = new Database(dbPath);
    const walPath = `${dbPath}-wal`;
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    const dbSize = fs.statSync(dbPath).size;

    // WAL checkpoint (merge WAL into main DB, truncate WAL)
    let checkpointDuration = 0;
    try {
      const start = Date.now();
      db.pragma("wal_checkpoint(TRUNCATE)");
      checkpointDuration = Date.now() - start;
    } catch {}

    // Vacuum (optional, only if WAL was large)
    let vacuumDuration = 0;
    if (walSize > 10 * 1024 * 1024) {
      // Only vacuum if WAL > 10MB
      try {
        const start = Date.now();
        db.pragma("auto_vacuum = FULL");
        db.exec("VACUUM");
        vacuumDuration = Date.now() - start;
      } catch {}
    }

    const newWalSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

    results.push({
      db: dbName,
      sizeBytes: dbSize,
      walSizeBytes: newWalSize,
      checkpointed: newWalSize < walSize,
      checkpointDurationMs: checkpointDuration,
      vacuumed: vacuumDuration > 0,
      vacuumDurationMs: vacuumDuration,
    });

    console.log(
      `[WAL] ${dbName}: size=${(dbSize / 1024 / 1024).toFixed(1)}MB WAL=${(newWalSize / 1024 / 1024).toFixed(1)}MB checkpoint=${checkpointDuration}ms vacuum=${vacuumDuration}ms`
    );

    db.close();
  }

  // Save report
  const reportPath = `data/wal-health-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: Date.now(), results }, null, 2));
  console.log(`[WAL] Report: ${reportPath}`);
}

main().catch(e => { console.error("[WAL] Fatal:", e); process.exit(1); });
