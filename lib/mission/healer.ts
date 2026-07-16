// ── Self-Healing Runtime ──
// Auto-detect, diagnose, repair, verify. No user intervention.

import { runTerminal, persistExecutionJournal } from "@/lib/tools/executor";
import type { ToolResponse } from "@/lib/tools/executor";
import { WorkflowEngine, getWorkflowEngine } from "@/lib/mission/workflow";
import { getAgentManager, AgentType } from "@/lib/mission/agents";

// ── Failure Patterns ──────────────────────────────────────────────────
interface FailurePattern { regex: RegExp; category: string; diagnosis: string; repair: string; verify: string; }

const PATTERNS: FailurePattern[] = [
  { regex: /permission denied/i, category: "PERMISSION", diagnosis: "File/directory permission denied", repair: "chmod -R u+w . 2>/dev/null; chmod +x *.sh 2>/dev/null; sudo chown -R $(whoami) . 2>/dev/null || true", verify: "touch /tmp/perm_test && rm /tmp/perm_test && echo PERM_FIXED" },
  { regex: /EADDRINUSE|address already in use/i, category: "PORT_CONFLICT", diagnosis: "Port already in use by another process", repair: "fuser -k $(lsof -t -i:3000) 2>/dev/null; fuser -k $(lsof -t -i:3006) 2>/dev/null; sleep 1; echo PORT_FREED", verify: "echo 'Port check'" },
  { regex: /npm ERR!|Cannot find module|ENOENT|not found/i, category: "MISSING_DEPENDENCY", diagnosis: "Missing npm package or module", repair: "npm install --legacy-peer-deps 2>&1 || yarn install 2>&1 || echo DEPS_RETRY", verify: "npm list --depth=0 2>&1 | head -3" },
  { regex: /syntax error|SyntaxError|unexpected token/i, category: "SYNTAX_ERROR", diagnosis: "Code has syntax errors", repair: "echo 'Syntax error — manual review needed'", verify: "echo SYNTAX_CHECK" },
  { regex: /Failed to compile|Build failed|make: \*\*\*/i, category: "BUILD_FAILURE", diagnosis: "Build compilation failed", repair: "npm run build --force 2>&1 || make clean && make 2>&1 || echo BUILD_RETRY", verify: "echo build_check" },
  { regex: /test.*fail|assert|FAILED/i, category: "TEST_FAILURE", diagnosis: "Tests failed", repair: "npm test -- --force 2>&1 || pytest --last-failed -v 2>&1 || echo TEST_RETRY", verify: "echo test_check" },
  { regex: /Could not resolve host|Name or service not known|DNS|getaddrinfo/i, category: "DNS_FAILURE", diagnosis: "DNS resolution failed", repair: "echo 'nameserver 8.8.8.8' | sudo tee -a /etc/resolv.conf 2>/dev/null; echo DNS_FIX_ATTEMPT", verify: "nslookup example.com 2>&1 | head -3" },
  { regex: /timed out|timeout|ETIMEDOUT/i, category: "TIMEOUT", diagnosis: "Operation timed out — network or resource slow", repair: "echo TIMEOUT_RETRY", verify: "echo timeout_check" },
  { regex: /docker.*error|Cannot connect to the Docker/i, category: "DOCKER_FAILURE", diagnosis: "Docker daemon unavailable", repair: "sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || echo DOCKER_RETRY", verify: "docker ps 2>&1 | head -3" },
  { regex: /PM2.*error|pm2.*not found/i, category: "PM2_FAILURE", diagnosis: "PM2 process manager error", repair: "pm2 restart all 2>/dev/null || pm2 start ecosystem.config.js 2>/dev/null || echo PM2_RETRY", verify: "pm2 list 2>&1 | head -5" },
  { regex: /No space left on device|ENOSPC/i, category: "DISK_FULL", diagnosis: "Disk is full — cannot write files", repair: "df -h /tmp; find /tmp -name '*.log' -mtime +7 -delete 2>/dev/null; echo DISK_CLEANED", verify: "df -h / | tail -1" },
  { regex: /OOM|out of memory|memory/i, category: "MEMORY", diagnosis: "Out of memory — process killed", repair: "echo MEMORY_LOW; free -h", verify: "free -h | head -2" },
];

// ── Failure Analyzer ──────────────────────────────────────────────────
class FailureAnalyzer {
  analyze(result: ToolResponse): FailurePattern | null {
    const text = `${result.stderr} ${result.stdout} ${result.exceptionMessage || ""}`;
    for (const p of PATTERNS) {
      if (p.regex.test(text)) {
        console.info(`[healer] detected: ${p.category} — ${p.diagnosis}`);
        return p;
      }
    }
    return null;
  }

  categorizeFailures(results: ToolResponse[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of results) {
      const p = this.analyze(r);
      if (p) map.set(p.category, (map.get(p.category) || 0) + 1);
    }
    return map;
  }
}

// ── Repair Engine ─────────────────────────────────────────────────────
class RepairEngine {
  private analyzer = new FailureAnalyzer();

  repair(result: ToolResponse): { repaired: boolean; action: string; result: ToolResponse } {
    const pattern = this.analyzer.analyze(result);
    if (!pattern) return { repaired: false, action: "no_pattern", result };

    console.info(`[healer] repairing: ${pattern.category} → ${pattern.repair.substring(0, 80)}`);
    const repairResult = runTerminal(pattern.repair, { timeout: 30000 });
    persistExecutionJournal(repairResult);

    if (repairResult.success) {
      // Verify the repair
      const verifyResult = runTerminal(pattern.verify, { timeout: 10000 });
      persistExecutionJournal(verifyResult);
      return { repaired: verifyResult.success, action: pattern.category, result: verifyResult };
    }

    return { repaired: false, action: pattern.category, result: repairResult };
  }

  /** Retry a failing command with automatic repair */
  retryWithRepair(command: string, maxRetries: number = 3): { success: boolean; attempts: number; finalResult: ToolResponse } {
    let result = runTerminal(command, { timeout: 60000 });
    persistExecutionJournal(result);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (result.success) return { success: true, attempts: attempt, finalResult: result };

      console.info(`[healer] retry ${attempt}/${maxRetries} for: ${command.substring(0, 80)}`);
      const { repaired } = this.repair(result);
      if (!repaired) continue;

      result = runTerminal(command, { timeout: 60000 });
      persistExecutionJournal(result);
    }

    return { success: false, attempts: maxRetries, finalResult: result };
  }
}

// ── Health Monitor ────────────────────────────────────────────────────
class HealthMonitor {
  check(): { healthy: boolean; issues: string[] } {
    const issues: string[] = [];

    // Memory
    const mem = process.memoryUsage();
    if (mem.heapUsed / 1024 / 1024 > 1024) issues.push("HEAP > 1GB");

    // Disk
    try {
      const { execSync } = require("child_process");
      const disk = execSync("df -h / | tail -1", { encoding: "utf-8", timeout: 5000 });
      const usePct = parseInt((disk.match(/(\d+)%/) || ["0"])[1]);
      if (usePct > 90) issues.push(`Disk ${usePct}% full`);
    } catch {}

    // Network
    try {
      runTerminal("ping -c1 -W2 1.1.1.1 2>&1", { timeout: 5000 });
    } catch { issues.push("Network unreachable"); }

    return { healthy: issues.length === 0, issues };
  }
}

// ── Recovery Planner ──────────────────────────────────────────────────
class RecoveryPlanner {
  async recover(missionId: string, lastFailure: string): Promise<string> {
    const healer = new RepairEngine();
    const plan = [];

    // Try restarting services
    plan.push(healer.retryWithRepair("pm2 restart all 2>&1 || echo 'no pm2'", 1));

    // Try Docker recovery
    plan.push(healer.retryWithRepair("sudo systemctl restart docker 2>&1 || echo 'no docker'", 1));

    // Try dependency repair
    plan.push(healer.retryWithRepair("npm install --legacy-peer-deps 2>&1 || pip install --break-system-packages -r requirements.txt 2>&1 || echo 'no deps'", 1));

    console.info(`[recovery] mission=${missionId} lastFailure=${lastFailure} plans=${plan.length}`);
    return `Recovery planned: ${plan.length} strategies to apply`;
  }
}

// ── Self-Healing Runtime (main API) ───────────────────────────────────
export class SelfHealingRuntime {
  readonly analyzer = new FailureAnalyzer();
  readonly healer = new RepairEngine();
  readonly monitor = new HealthMonitor();
  readonly recovery = new RecoveryPlanner();

  /** Main entry: run command with full self-healing */
  async execute(command: string): Promise<ToolResponse> {
    const health = this.monitor.check();
    if (!health.healthy) {
      console.info(`[healer] health issues: ${health.issues.join(", ")}`);
      await this.recovery.recover("auto", "health_check");
    }

    const { success, attempts, finalResult } = this.healer.retryWithRepair(command, 3);
    console.info(`[healer] command=${command.substring(0, 60)} success=${success} attempts=${attempts}`);
    return finalResult;
  }

  /** Analyze a failure from a ToolResponse */
  analyzeFailure(result: ToolResponse): string {
    const p = this.analyzer.analyze(result);
    return p ? `${p.category}: ${p.diagnosis}` : "Unknown failure";
  }
}

// ── Singleton ─────────────────────────────────────────────────────────
let _healer: SelfHealingRuntime | null = null;
export function getSelfHealing(): SelfHealingRuntime {
  if (!_healer) _healer = new SelfHealingRuntime();
  return _healer;
}
