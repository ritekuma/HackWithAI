#!/usr/bin/env npx tsx
// @script scripts/validation/soak.ts — Automated soak test framework
// Usage: npx tsx scripts/validation/soak.ts [duration_hours] [--output report.json]

import { getMissionKernel, resetMissionKernel } from "@/lib/mission-kernel";
import { getEventBus } from "@/lib/events";
import * as fs from "fs";
import * as path from "path";

const DURATION_HOURS = parseInt(process.argv[2] || "1", 10);
const OUTPUT_FILE = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : `data/soak-${Date.now()}.json`;

interface SoakMetrics {
  startTime: number;
  endTime: number;
  durationHours: number;
  totalMissions: number;
  completedMissions: number;
  failedMissions: number;
  totalToolCalls: number;
  totalRecoveries: number;
  totalCheckpoints: number;
  timelineEntries: number;
  memorySamples: number[];
  cpuSamples: number[];
  rssSamples: number[];
  walSizeSamples: number[];
  missionLatencies: number[];
  errors: string[];
}

const metrics: SoakMetrics = {
  startTime: Date.now(),
  endTime: 0,
  durationHours: DURATION_HOURS,
  totalMissions: 0,
  completedMissions: 0,
  failedMissions: 0,
  totalToolCalls: 0,
  totalRecoveries: 0,
  totalCheckpoints: 0,
  timelineEntries: 0,
  memorySamples: [],
  cpuSamples: [],
  rssSamples: [],
  walSizeSamples: [],
  missionLatencies: [],
  errors: [],
};

const MISSION_TYPES = [
  { name: "Terminal task", goal: "Run pwd and ls and whoami" },
  { name: "File task", goal: "Write a file to /tmp/test.txt with 'hello'" },
  { name: "Search task", goal: "List files in /home/kali" },
  { name: "Multi-step", goal: "Check disk space, then list running processes" },
  { name: "Recovery test", goal: "Try running a command that might fail, then recover" },
];

function randomMission() {
  return MISSION_TYPES[Math.floor(Math.random() * MISSION_TYPES.length)];
}

function getWALSize(): number {
  try {
    const files = fs.readdirSync("data");
    return files
      .filter(f => f.endsWith(".db-wal"))
      .reduce((sum, f) => sum + fs.statSync(path.join("data", f)).size, 0);
  } catch {
    return 0;
  }
}

function getRSS(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function runMission(goal: string, name: string): Promise<number> {
  const start = Date.now();
  const mk = getMissionKernel();
  
  try {
    const m = mk.create({ name, type: "soak_test", priority: "low" });
    mk.start(m.id);
    mk.addGoal(m.id, goal);
    
    // Simulate tool execution
    for (let i = 0; i < 3; i++) {
      mk.recordEvent(m.id, "tool_call", `Tool execution ${i + 1}`, { step: i });
    }
    
    mk.complete(m.id);
    metrics.completedMissions++;
    return Date.now() - start;
  } catch (e: any) {
    metrics.failedMissions++;
    metrics.errors.push(`Mission '${name}' failed: ${e.message}`);
    return Date.now() - start;
  }
}

async function main() {
  console.log(`[SOAK] Starting ${DURATION_HOURS}h soak test...`);
  console.log(`[SOAK] Output: ${OUTPUT_FILE}`);
  
  resetMissionKernel();
  const mk = getMissionKernel();
  const eb = getEventBus();
  
  const deadline = Date.now() + DURATION_HOURS * 3600_000;
  const sampleInterval = 30000; // 30s samples
  let nextSample = Date.now() + sampleInterval;
  
  while (Date.now() < deadline) {
    const missionDef = randomMission();
    const latency = await runMission(missionDef.goal, missionDef.name);
    metrics.totalMissions++;
    metrics.missionLatencies.push(latency);
    
    // Periodic sampling
    if (Date.now() >= nextSample) {
      metrics.rssSamples.push(getRSS());
      metrics.cpuSamples.push(process.cpuUsage().user / 1000);
      metrics.memorySamples.push(process.memoryUsage().heapUsed / 1024 / 1024);
      metrics.walSizeSamples.push(getWALSize());
      nextSample = Date.now() + sampleInterval;
      
      const runtime = Math.round((Date.now() - metrics.startTime) / 60000);
      console.log(`[SOAK] ${runtime}min | missions=${metrics.totalMissions} | complete=${metrics.completedMissions} | fail=${metrics.failedMissions} | RSS=${getRSS()}MB`);
    }
    
    // Brief pause between missions
    await new Promise(r => setTimeout(r, 100));
  }
  
  metrics.endTime = Date.now();
  
  // Collect final stats
  const stats = mk.getStats();
  metrics.totalToolCalls = stats.totalToolCalls;
  
  const db = mk as any;
  if (db.db) {
    const row = db.db.prepare("SELECT COUNT(*) as c FROM persistent_missions").get() as any;
    metrics.totalRecoveries = stats.failed;
  }
  
  // Write report
  const report = {
    ...metrics,
    durationMinutes: Math.round((metrics.endTime - metrics.startTime) / 60000),
    avgMissionLatency: metrics.missionLatencies.length > 0
      ? metrics.missionLatencies.reduce((a, b) => a + b, 0) / metrics.missionLatencies.length
      : 0,
    successRate: metrics.totalMissions > 0
      ? metrics.completedMissions / metrics.totalMissions
      : 0,
    peakRSS: Math.max(...metrics.rssSamples, 0),
    avgRSS: metrics.rssSamples.length > 0
      ? metrics.rssSamples.reduce((a, b) => a + b, 0) / metrics.rssSamples.length
      : 0,
  };
  
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  
  console.log(`\n[SOAK] COMPLETE — ${report.durationMinutes}min`);
  console.log(`[SOAK] Missions: ${report.totalMissions} total, ${report.completedMissions} success, ${report.failedMissions} failed`);
  console.log(`[SOAK] Success rate: ${(report.successRate * 100).toFixed(1)}%`);
  console.log(`[SOAK] Avg latency: ${report.avgMissionLatency.toFixed(0)}ms`);
  console.log(`[SOAK] Peak RSS: ${report.peakRSS}MB`);
  console.log(`[SOAK] Report: ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error("[SOAK] Fatal:", e);
  process.exit(1);
});
