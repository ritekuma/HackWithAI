// ── Execution Policy Engine ──
// Execution-first agents. Think minimally, execute, verify, repair, retry.
// Integrates with MissionController, GoalValidator, Execution Journal, Tools.

import { runTerminal, persistExecutionJournal, setMissionContext, nextReasoningCycle } from "@/lib/tools/executor";
import type { ToolResponse } from "@/lib/tools/executor";

// ── Policy Types ──────────────────────────────────────────────────────
export type PolicyType = "builder" | "researcher" | "debugger" | "general";
export type PolicyProfile = "autonomous" | "fast" | "balanced" | "safe";
export type ExecutionDecision = "execute" | "verify" | "repair" | "retry" | "complete" | "abort";

export interface ExecutionPlan {
  policy: PolicyType;
  profile: PolicyProfile;
  steps: ExecutionStep[];
  goal: string;
  maxRetries: number;
}

export interface ExecutionStep {
  action: string;
  command: string;
  verify: string;
  repair: string;
  retries: number;
  completed: boolean;
  result?: ToolResponse;
}

// ── Policy Factory ────────────────────────────────────────────────────
class ExecutionPolicyEngine {
  private currentRetry = 0;

  classify(task: string): ExecutionPlan {
    const plan: ExecutionPlan = {
      policy: this.detectPolicy(task),
      profile: "autonomous",
      steps: [],
      goal: task.substring(0, 100),
      maxRetries: 3,
    };

    plan.steps = this.buildSteps(plan.policy, task);
    return plan;
  }

  private detectPolicy(task: string): PolicyType {
    const t = task.toLowerCase();
    if (/create|build|generate|write|implement|code|script/i.test(t)) return "builder";
    if (/research|search|find|collect|gather|analyze/i.test(t)) return "researcher";
    if (/debug|fix|repair|patch|error|bug|crash/i.test(t)) return "debugger";
    return "general";
  }

  private buildSteps(policy: PolicyType, task: string): ExecutionStep[] {
    switch (policy) {
      case "builder": return [
        { action: "Generate script", command: `echo '# Auto-generated' > /tmp/build_script.sh && echo 'echo BUILD_START' >> /tmp/build_script.sh`, verify: "cat /tmp/build_script.sh | head -3", repair: "echo 'BUILD FAILED'", retries: 0, completed: false },
      ];
      case "researcher": return [
        { action: "Collect data", command: `echo "Researching: ${task}"`, verify: "echo Research started", repair: "echo 'Research retry'", retries: 0, completed: false },
      ];
      case "debugger": return [
        { action: "Collect diagnostics", command: "echo '=== Diagnostics ===' && date", verify: "echo Diagnostics collected", repair: "echo 'Debug retry'", retries: 0, completed: false },
      ];
      default: return [
        { action: "Execute task", command: `echo "Executing: ${task}"`, verify: "echo Execution started", repair: "echo 'Retry execution'", retries: 0, completed: false },
      ];
    }
  }

  /** Execute a step and return the result */
  executeStep(step: ExecutionStep): ToolResponse {
    console.error(`[policy-engine] executing: ${step.action}`);
    const result = runTerminal(step.command, { timeout: 30000 });
    persistExecutionJournal(result);
    step.result = result;
    return result;
  }

  /** Verify a step's result */
  verifyStep(step: ExecutionStep): boolean {
    if (!step.result) return false;
    if (step.result.success && step.result.exitCode === 0) {
      step.completed = true;
      return true;
    }
    return false;
  }

  /** Decide next action based on step result */
  decide(step: ExecutionStep): ExecutionDecision {
    if (step.completed) return "complete";
    if (step.retries < 3) {
      step.retries++;
      this.currentRetry++;
      console.error(`[policy-engine] retry ${step.retries}/3 for: ${step.action}`);
      return "retry";
    }
    return "abort";
  }

  /** Self-repair: analyze error and generate fix */
  repair(step: ExecutionStep): ExecutionStep {
    const err = step.result?.stderr || "";
    const code = step.result?.exitCode || 1;
    let repairCmd = step.repair;

    // Common repair patterns
    if (err.includes("permission denied")) repairCmd = `chmod +x /tmp/build_script.sh && ${step.command}`;
    else if (err.includes("not found") || err.includes("No such file")) repairCmd = `mkdir -p /tmp && ${step.command}`;
    else if (code === 127) repairCmd = `which bash && ${step.command}`;
    else if (err.includes("EADDRINUSE") || err.includes("address already in use")) repairCmd = `fuser -k \$(lsof -t -i:3006) 2>/dev/null; ${step.command}`;

    return { ...step, command: repairCmd, retries: step.retries, completed: false };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────
let _engine: ExecutionPolicyEngine | null = null;
export function getPolicyEngine(): ExecutionPolicyEngine {
  if (!_engine) _engine = new ExecutionPolicyEngine();
  return _engine;
}

/**
 * Execute a task with the policy engine.
 * Think briefly → plan → execute → verify → repair → retry → complete.
 */
export async function executeWithPolicy(task: string): Promise<{ success: boolean; steps: ExecutionStep[]; message: string }> {
  const engine = getPolicyEngine();
  const plan = engine.classify(task);
  console.error(`[policy-engine] policy=${plan.policy} profile=${plan.profile} goal=${plan.goal}`);

  for (const step of plan.steps) {
    // Execute
    engine.executeStep(step);

    // Verify
    if (!engine.verifyStep(step)) {
      // Repair + retry
      let attempts = 0;
      while (!step.completed && attempts < plan.maxRetries) {
        const repaired = engine.repair(step);
        console.error(`[policy-engine] repair attempt ${attempts + 1}: ${repaired.command.substring(0, 80)}`);
        engine.executeStep({ ...step, command: repaired.command });
        engine.verifyStep(step);
        attempts++;
      }
    }

    const decision = engine.decide(step);
    if (decision === "abort") {
      return { success: false, steps: plan.steps, message: `Aborted after ${step.retries} retries` };
    }
  }

  return { success: true, steps: plan.steps, message: `Completed via ${plan.policy} policy` };
}

export { ExecutionPolicyEngine as Engine };
