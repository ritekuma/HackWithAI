#!/usr/bin/env npx tsx
// @script scripts/validation/load.ts — Concurrent mission load test
// Usage: npx tsx scripts/validation/load.ts [concurrency] [--output report.json]

import { getMissionKernel, resetMissionKernel } from "@/lib/mission-kernel";
import * as fs from "fs";
import * as path from "path";

const CONCURRENCY = parseInt(process.argv[2] || "50", 10);
const OUTPUT_FILE = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : `data/load-${Date.now()}.json`;

interface LoadMetrics {
  concurrency: number;
  totalMissions: number;
  elapsedMs: number;
  throughput: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  minLatency: number;
  failures: number;
  successRate: number;
}

async function runLoadTest(concurrency: number): Promise<LoadMetrics> {
  resetMissionKernel();
  const mk = getMissionKernel();
  
  const latencies: number[] = [];
  let failures = 0;
  const start = Date.now();
  
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push((async () => {
      const s = Date.now();
      try {
        const m = mk.create({ name: `Load ${i}`, type: "load_test" });
        mk.start(m.id);
        mk.addGoal(m.id, `Load test goal ${i}`);
        mk.updateGoal(m.id, mk.get(m.id)!.context.goals[0].id, { status: "completed" });
        mk.complete(m.id);
        latencies.push(Date.now() - s);
      } catch {
        failures++;
      }
    })());
  }
  
  await Promise.all(promises);
  
  const elapsed = Date.now() - start;
  latencies.sort((a, b) => a - b);
  
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  
  return {
    concurrency,
    totalMissions: concurrency,
    elapsedMs: elapsed,
    throughput: Math.round(concurrency / (elapsed / 1000)),
    avgLatency: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50Latency: p50,
    p95Latency: p95,
    p99Latency: p99,
    maxLatency: latencies[latencies.length - 1] || 0,
    minLatency: latencies[0] || 0,
    failures,
    successRate: (concurrency - failures) / concurrency,
  };
}

async function main() {
  const levels = CONCURRENCY <= 25 ? [10, 25] : [25, 50, 100];
  if (CONCURRENCY > 100) levels.push(CONCURRENCY);
  
  console.log(`[LOAD] Testing concurrency levels: ${levels.join(", ")}`);
  
  const results: LoadMetrics[] = [];
  for (const level of levels) {
    console.log(`[LOAD] ${level} concurrent missions...`);
    const result = await runLoadTest(level);
    results.push(result);
    console.log(`  Throughput: ${result.throughput}/s | Avg: ${result.avgLatency}ms | P95: ${result.p95Latency}ms | Success: ${(result.successRate * 100).toFixed(1)}%`);
  }
  
  const report = {
    timestamp: Date.now(),
    levels: results,
    summary: {
      maxThroughput: Math.max(...results.map(r => r.throughput)),
      bestP95: Math.min(...results.map(r => r.p95Latency)),
      highestLevel: Math.max(...results.map(r => r.concurrency)),
      totalFailures: results.reduce((s, r) => s + r.failures, 0),
    },
  };
  
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  
  console.log(`\n[LOAD] Max throughput: ${report.summary.maxThroughput}/s`);
  console.log(`[LOAD] Best P95: ${report.summary.bestP95}ms`);
  console.log(`[LOAD] Report: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error("[LOAD] Fatal:", e); process.exit(1); });
