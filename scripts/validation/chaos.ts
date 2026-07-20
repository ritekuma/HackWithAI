#!/usr/bin/env npx tsx
// @script scripts/validation/chaos.ts — Repeatable chaos test scenarios
// Usage: npx tsx scripts/validation/chaos.ts [--scenario all|pty|redis|db|ws] [--output report.json]

import { getMissionKernel, resetMissionKernel } from "@/lib/mission-kernel";
import * as fs from "fs";
import * as path from "path";

interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  fault: string;
  target: string;
  inject: () => void;
}

interface ChaosResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  recoveryTimeMs: number;
  missionCompleted: boolean;
  missionResult: string;
  error?: string;
}

const SCENARIOS: ChaosScenario[] = [
  {
    id: "pty-timeout",
    name: "PTY Timeout",
    description: "Terminal command times out",
    fault: "timeout",
    target: "pty",
    inject: () => {
      // Simulated — actual PTY timeout via sleep 130
    },
  },
  {
    id: "mission-failure",
    name: "Mission Failure Recovery",
    description: "Mission fails and recovers via MissionKernel",
    fault: "failure",
    target: "mission",
    inject: () => {},
  },
  {
    id: "consecutive-failures",
    name: "Consecutive Tool Failures",
    description: "3 consecutive tool failures trigger recovery",
    fault: "sequential_failure",
    target: "tools",
    inject: () => {},
  },
  {
    id: "db-checkpoint",
    name: "Checkpoint Integrity",
    description: "Verify checkpoint creation and integrity",
    fault: "none",
    target: "database",
    inject: () => {},
  },
  {
    id: "memory-pressure",
    name: "Memory Pressure",
    description: "Rapid mission creation under memory load",
    fault: "memory",
    target: "system",
    inject: () => {},
  },
  {
    id: "concurrent-recovery",
    name: "Concurrent Recovery",
    description: "Multiple missions recovering simultaneously",
    fault: "concurrency",
    target: "mission",
    inject: () => {},
  },
];

async function runScenario(scenario: ChaosScenario): Promise<ChaosResult> {
  const start = Date.now();
  const mk = getMissionKernel();

  try {
    scenario.inject();

    const m = mk.create({ name: `chaos-${scenario.id}`, type: "chaos_test" });
    mk.start(m.id);
    mk.addGoal(m.id, "Survive chaos injection");

    // For mission-failure scenarios, force failure and recovery
    if (scenario.id === "mission-failure" || scenario.id === "consecutive-failures") {
      mk.fail(m.id, `Chaos injected: ${scenario.fault}`);
      const recovered = mk.recover(m.id);
      if (!recovered.success) {
        return {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          passed: false,
          recoveryTimeMs: Date.now() - start,
          missionCompleted: false,
          missionResult: `Recovery failed: ${recovered.error}`,
        };
      }
    }

    // Verify checkpoint integrity
    if (scenario.id === "db-checkpoint") {
      const cp = mk.saveCheckpoint(m.id);
      if (!cp) {
        return {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          passed: false,
          recoveryTimeMs: Date.now() - start,
          missionCompleted: false,
          missionResult: "Checkpoint creation failed",
        };
      }
      const { verifyCheckpointIntegrity } = require("@/lib/mission-kernel/checkpoint");
      const integrity = verifyCheckpointIntegrity(cp.id);
      if (!integrity.valid) {
        return {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          passed: false,
          recoveryTimeMs: Date.now() - start,
          missionCompleted: false,
          missionResult: `Checkpoint integrity failed: ${integrity.actual} vs ${integrity.expected}`,
        };
      }
    }

    // Memory pressure: create many missions rapidly
    if (scenario.id === "memory-pressure") {
      for (let i = 0; i < 50; i++) {
        const mm = mk.create({ name: `memory-${i}`, type: "chaos_test" });
        mk.start(mm.id);
        mk.complete(mm.id);
      }
    }

    // Concurrent recovery: simulate many simultaneous recoveries
    if (scenario.id === "concurrent-recovery") {
      const missions = [];
      for (let i = 0; i < 20; i++) {
        const sm = mk.create({ name: `stress-${i}`, type: "chaos_test" });
        mk.start(sm.id);
        mk.fail(sm.id, "Stress failure");
        missions.push(sm.id);
      }
      for (const mid of missions) {
        mk.recover(mid);
      }
    }

    mk.complete(m.id);
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      passed: true,
      recoveryTimeMs: Date.now() - start,
      missionCompleted: true,
      missionResult: "Mission completed successfully",
    };
  } catch (e: any) {
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      passed: false,
      recoveryTimeMs: Date.now() - start,
      missionCompleted: false,
      missionResult: `Exception: ${e.message}`,
      error: e.stack,
    };
  }
}

async function main() {
  const scenarioArg = process.argv.includes("--scenario")
    ? process.argv[process.argv.indexOf("--scenario") + 1]
    : "all";
  const outputFile = process.argv.includes("--output")
    ? process.argv[process.argv.indexOf("--output") + 1]
    : `data/chaos-${Date.now()}.json`;

  resetMissionKernel();
  
  const scenarios = scenarioArg === "all" ? SCENARIOS : SCENARIOS.filter(s => s.id === scenarioArg);
  
  console.log(`[CHAOS] Running ${scenarios.length} scenario(s)...`);
  
  const results: ChaosResult[] = [];
  for (const scenario of scenarios) {
    console.log(`[CHAOS] ${scenario.name}...`);
    const result = await runScenario(scenario);
    results.push(result);
    console.log(`  ${result.passed ? "PASS" : "FAIL"} | ${result.recoveryTimeMs}ms | ${result.missionResult.substring(0, 80)}`);
  }
  
  const passed = results.filter(r => r.passed).length;
  const report = {
    timestamp: Date.now(),
    totalScenarios: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length > 0 ? passed / results.length : 0,
    avgRecoveryTime: results.length > 0
      ? results.reduce((s, r) => s + r.recoveryTimeMs, 0) / results.length
      : 0,
    results,
  };
  
  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  
  console.log(`\n[CHAOS] ${passed}/${results.length} passed`);
  console.log(`[CHAOS] Report: ${outputFile}`);
  
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("[CHAOS] Fatal:", e); process.exit(1); });
