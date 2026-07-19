// ── Executive Kernel ──
// The runtime of the AI Company. Manages executive lifecycle, mission
// routing, and execution delegation. Replaces direct streamText calls
// with structured executive board decision-making.
//
// Architecture:
//   Gateway (chat-handler) → Executive Kernel → Mission → Tools
//
// The kernel owns: CEO, CTO, COO, CQA, CSO, CRO, CMO, CIO.
// Each executive is a lightweight runtime object (not a separate process).
// They coordinate through the kernel, not direct calls.

import { getPolicyEngine, type ExecutionPolicyEngine } from "@/lib/mission/policy";
import { RepairEngine } from "@/lib/mission/healer";
import { getLearningEngine } from "@/lib/mission/learning";
import { getBackendCapability } from "@/lib/ai/tool-capability-registry";
import { getEventBus } from "@/lib/events";
import { getConstitutionRuntime } from "@/lib/governance";
import { ExecutiveRuntime } from "@/lib/executive/executive-runtime";
import type { Decision } from "@/lib/executive/decision-engine";

// ── Types ─────────────────────────────────────────────────────────────

export type ExecutiveRole = "ceo" | "cto" | "coo" | "cqa" | "cso" | "cro" | "cmo" | "cio";

export type ExecutiveStatus = "active" | "idle" | "sleeping" | "meeting" | "overridden";

export interface ExecutiveState {
  role: ExecutiveRole;
  status: ExecutiveStatus;
  currentMission: string | null;
  decisions: number;
  overrides: number;
  healthScore: number;
  lastActive: number;
  spawnTime: number;
}

export interface KernelConfig {
  mode: "ask" | "agent";
  model: any;
  modelKey: string;
  providerMode: string;
  chatId: string;
  tools: any;
  systemPrompt: string;
}

// ── Executive Kernel ──────────────────────────────────────────────────

export class ExecutiveKernel {
  private executives: Map<ExecutiveRole, ExecutiveState> = new Map();
  private policyEngine: ExecutionPolicyEngine;
  private healer: RepairEngine;
  private learner: ReturnType<typeof getLearningEngine>;
  private config: KernelConfig;
  private booted = false;
  private missionCount = 0;
  private executiveRuntime: ExecutiveRuntime;

  constructor(config: KernelConfig) {
    this.config = config;
    this.policyEngine = getPolicyEngine();
    this.healer = new RepairEngine();
    this.learner = getLearningEngine();
    this.executiveRuntime = new ExecutiveRuntime({
      mode: config.mode,
      chatId: config.chatId,
      votingQuorum: 2,
      autoApprove: false,
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────

  /** Initialize the executive board. Called once at startup or on first agent request. */
  bootstrap(): ExecutiveState[] {
    if (this.booted) return this.getAllExecutives();
    
    const now = Date.now();
    const roles: ExecutiveRole[] = ["ceo", "cto", "coo", "cqa", "cso", "cro", "cmo", "cio"];
    
    for (const role of roles) {
      this.executives.set(role, {
        role,
        status: role === "ceo" || role === "cto" ? "active" : "idle",
        currentMission: null,
        decisions: 0,
        overrides: 0,
        healthScore: 100,
        lastActive: now,
        spawnTime: now,
      });
    }
    
    this.booted = true;
    console.info(`[KERNEL] Booted with ${roles.length} executives`);
    return this.getAllExecutives();
  }

  // ── Executive Lifecycle ───────────────────────────────────────────

  getExecutive(role: ExecutiveRole): ExecutiveState {
    return this.executives.get(role) || {
      role, status: "sleeping", currentMission: null,
      decisions: 0, overrides: 0, healthScore: 0,
      lastActive: 0, spawnTime: 0,
    };
  }

  getAllExecutives(): ExecutiveState[] {
    return Array.from(this.executives.values());
  }

  activateExecutive(role: ExecutiveRole): void {
    const exec = this.executives.get(role);
    if (exec) {
      exec.status = "active";
      exec.lastActive = Date.now();
    }
  }

  deactivateExecutive(role: ExecutiveRole): void {
    const exec = this.executives.get(role);
    if (exec) {
      exec.status = "idle";
      exec.lastActive = Date.now();
    }
  }

  assignMission(role: ExecutiveRole, missionId: string): void {
    const exec = this.executives.get(role);
    if (exec) {
      exec.currentMission = missionId;
      exec.status = "active";
      exec.lastActive = Date.now();
      getEventBus().publish("executive:assigned", {
        executiveId: role, executiveName: role.toUpperCase(),
        missionId, chatId: this.config.chatId,
      }, { missionId, chatId: this.config.chatId, executiveId: role });
    }
  }

  recordDecision(role: ExecutiveRole): void {
    const exec = this.executives.get(role);
    if (exec) exec.decisions++;
  }

  recordOverride(role: ExecutiveRole): void {
    const exec = this.executives.get(role);
    if (exec) exec.overrides++;
  }

  isHealthy(): boolean {
    // CEO must be active. At least CTO or COO must be active for agent mode.
    const ceo = this.executives.get("ceo");
    if (!ceo || ceo.status === "sleeping") return false;
    if (this.config.mode === "agent") {
      const cto = this.executives.get("cto");
      const coo = this.executives.get("coo");
      if ((!cto || cto.status === "sleeping") && (!coo || coo.status === "sleeping")) return false;
    }
    return true;
  }

  getHealthReport(): Record<string, unknown> {
    const execs = this.getAllExecutives();
    return {
      kernelStatus: this.booted ? "active" : "not_booted",
      missionCount: this.missionCount,
      executiveCount: execs.length,
      activeExecutives: execs.filter(e => e.status === "active").length,
      idleExecutives: execs.filter(e => e.status === "idle").length,
      sleepingExecutives: execs.filter(e => e.status === "sleeping").length,
      executives: execs.map(e => ({
        role: e.role,
        status: e.status,
        healthScore: e.healthScore,
        decisions: e.decisions,
        mission: e.currentMission,
      })),
    };
  }

  // ── Mission Operations ────────────────────────────────────────────

  /** Called when a new mission starts. The kernel assigns executives. */
  onMissionStart(missionId: string, goal: string): void {
    this.bootstrap();
    this.missionCount++;
    
    // CEO oversees every mission
    this.assignMission("ceo", missionId);
    
    // For agent mode: activate CTO (tool selection) + COO (workflow)
    if (this.config.mode === "agent") {
      this.assignMission("cto", missionId);
      this.assignMission("coo", missionId);
      this.assignMission("cqa", missionId);  // Verify evidence
    }
    
    // Classify task for planning
    const plan = this.policyEngine.classify(goal);
    console.info(`[KERNEL] Mission ${missionId} started | policy=${plan.policy} profile=${plan.profile} | ${this.getActiveCount()} executives assigned`);
  }

  /** Called when a mission completes */
  onMissionComplete(missionId: string): void {
    for (const [role, exec] of this.executives) {
      if (exec.currentMission === missionId) {
        exec.currentMission = null;
        exec.status = "idle";
        getEventBus().publish("executive:completed", {
          executiveId: role, durationMs: Date.now() - exec.lastActive,
          outcome: "completed",
        }, { missionId, chatId: this.config.chatId, executiveId: role });
      }
    }
    console.info(`[KERNEL] Mission ${missionId} completed | ${this.getActiveCount()} executives still active`);
  }

  /** Prepare the execution context before streamText */
  prepareExecutionContext(): {
    contextBlock: string;
    healthReport: Record<string, unknown>;
  } {
    this.bootstrap();
    
    // Build context block for the LLM prompt
    const execs = this.getAllExecutives();
    const activeCount = execs.filter(e => e.status === "active").length;
    
    const lines = ["=== EXECUTIVE BOARD ==="];
    for (const e of execs) {
      const icon = e.status === "active" ? "●" : e.status === "idle" ? "○" : "◌";
      lines.push(`  ${icon} ${e.role.toUpperCase()}: ${e.status} | decisions=${e.decisions} | health=${e.healthScore}%`);
    }
    lines.push(`  Active: ${activeCount}/${execs.length} | Missions: ${this.missionCount}`);
    lines.push("=== END EXECUTIVE BOARD ===");
    
    return {
      contextBlock: lines.join("\n"),
      healthReport: this.getHealthReport(),
    };
  }

  /** Check if a tool execution should be allowed based on board decisions */
  reviewToolExecution(command: string): { allowed: boolean; reason: string; riskLevel: string; decision?: Decision } {
    const eb = getEventBus();

    // Executive Board review
    const result = this.executiveRuntime.authorizeTool(
      "run_terminal_cmd",
      command,
      undefined,
    );

    if (result.allowed) {
      this.recordDecision("cto");
      eb.publish("executive:decision", {
        executiveId: "cto", decision: "approved",
        reasoning: result.decision.reasoning,
        confidence: result.decision.confidence,
      }, { chatId: this.config.chatId, executiveId: "cto" });
    } else {
      // Check if CSO blocked
      this.recordDecision("cso");
      eb.publish("executive:decision", {
        executiveId: "cso", decision: "rejected",
        reasoning: result.decision.reasoning,
        confidence: result.decision.confidence,
      }, { chatId: this.config.chatId, executiveId: "cso" });
    }

    return {
      allowed: result.allowed,
      reason: result.allowed ? "board-approved" : `board-rejected: ${result.reasoning}`,
      riskLevel: /rm -rf|sudo|mkfs/.test(command) ? "critical" : "medium",
      decision: result.decision,
    };
  }

  // ── Decision History & Escalation ─────────────────────

  getDecisionHistory(): Decision[] {
    return this.executiveRuntime.getDecisionHistory();
  }

  escalateDecision(decisionId: string, to: ExecutiveRole): Decision | null {
    return this.executiveRuntime.escalate(decisionId, to as any);
  }

  getBoardStats() {
    return this.executiveRuntime.getDepartmentStats();
  }

  // ── Private ───────────────────────────────────────────────────────

  private getActiveCount(): number {
    return Array.from(this.executives.values()).filter(e => e.status === "active").length;
  }
}

// ── Global kernel instance (one per process) ──────────────────────────

let _globalKernel: ExecutiveKernel | null = null;

export function getExecutiveKernel(config?: KernelConfig): ExecutiveKernel {
  if (config) {
    _globalKernel = new ExecutiveKernel(config);
  }
  if (!_globalKernel) {
    throw new Error("ExecutiveKernel not initialized. Call getExecutiveKernel(config) first.");
  }
  return _globalKernel;
}

export function resetExecutiveKernel(): void {
  _globalKernel = null;
}
