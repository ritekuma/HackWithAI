// @module mission-kernel/mission-kernel v1.0.0 — Unified Mission Execution Kernel

import { randomUUID } from "crypto";
import {
  type MissionState,
  validateTransition,
  isTerminalState,
  isActiveState,
  getAvailableTransitions,
} from "./state-machine";
import {
  recordTimelineEntry,
  getTimeline,
  getTimelineByType,
  getTimelineCount,
  type TimelineEntry,
} from "./timeline";
import {
  createCheckpoint,
  getLatestCheckpoint,
  loadCheckpoint,
  restoreCheckpoint,
  verifyCheckpointIntegrity,
  type MissionCheckpoint,
  type CreateCheckpointInput,
} from "./checkpoint";
import { getEventBus } from "@/lib/events";
import { getConstitutionRuntime } from "@/lib/governance";

export type MissionPriority = "critical" | "high" | "medium" | "low";

export interface MissionContext {
  goals: MissionGoal[];
  constraints: string[];
  allowedTools: string[];
  workspaceId?: string;
  chatId?: string;
  userId?: string;
  sessionId?: string;
  executiveId?: string;
  metadata: Record<string, unknown>;
}

export interface MissionGoal {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  evidence?: Record<string, unknown>;
}

export interface MissionEvidence {
  id: string;
  type: string;
  source: string;
  confidence: number;
  timestamp: number;
  data: Record<string, unknown>;
  correlationId?: string;
}

export interface MissionDefinition {
  id: string;
  name: string;
  type: string;
  priority: MissionPriority;
  owner: string;
  state: MissionState;
  context: MissionContext;
  features: string[];
  progress: number;
  toolCallsTotal: number;
  tokensUsed: number;
  costDollars: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  recoveryCount: number;
  error?: string;
}

interface MissionStore {
  [id: string]: MissionDefinition;
}

class MissionKernel {
  private missions: MissionStore = {};
  private initialized: boolean = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    console.info("[MISSION] kernel initialized");
  }

  // ── CRUD ────────────────────────────────────────────

  create(input: {
    name: string;
    type?: string;
    priority?: MissionPriority;
    owner?: string;
    context?: Partial<MissionContext>;
    features?: string[];
    chatId?: string;
    userId?: string;
    workspaceId?: string;
  }): MissionDefinition {
    const id = `mission-${randomUUID()}`;
    const now = Date.now();

    const mission: MissionDefinition = {
      id,
      name: input.name,
      type: input.type || "general",
      priority: input.priority || "medium",
      owner: input.owner || "system",
      state: "created",
      context: {
        goals: input.context?.goals || [],
        constraints: input.context?.constraints || [],
        allowedTools: input.context?.allowedTools || [],
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        userId: input.userId,
        metadata: input.context?.metadata || {},
      },
      features: input.features || [],
      progress: 0,
      toolCallsTotal: 0,
      tokensUsed: 0,
      costDollars: 0,
      createdAt: now,
      updatedAt: now,
      recoveryCount: 0,
    };

    this.missions[id] = mission;

    recordTimelineEntry({
      missionId: id,
      type: "state_change",
      actor: "mission-kernel",
      detail: `Mission '${input.name}' created`,
    });

    try {
      const eb = getEventBus();
      eb.publish("mission:created", {
        missionId: id,
        name: input.name,
        goal: input.name,
      }, { missionId: id, chatId: input.chatId, userId: input.userId, workspaceId: input.workspaceId });
    } catch (e) {
      console.debug(`[MISSION] event publish skipped: ${(e as Error).message}`);
    }

    console.info(`[MISSION] created id=${id} name=${input.name} state=created`);
    return mission;
  }

  get(id: string): MissionDefinition | undefined {
    return this.missions[id];
  }

  list(filter?: { state?: MissionState; type?: string; owner?: string }): MissionDefinition[] {
    let list = Object.values(this.missions);
    if (filter?.state) list = list.filter(m => m.state === filter.state);
    if (filter?.type) list = list.filter(m => m.type === filter.type);
    if (filter?.owner) list = list.filter(m => m.owner === filter.owner);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  getAll(): MissionDefinition[] {
    return Object.values(this.missions).sort((a, b) => b.createdAt - a.createdAt);
  }

  count(): number {
    return Object.keys(this.missions).length;
  }

  // ── STATE TRANSITIONS ───────────────────────────────

  transition(id: string, to: MissionState, reason?: string): { success: boolean; error?: string; checkpointId?: string } {
    const mission = this.missions[id];
    if (!mission) return { success: false, error: `Mission '${id}' not found` };

    const validation = validateTransition(mission.state, to);
    if (!validation.allowed) {
      console.warn(`[MISSION] invalid transition id=${id} ${mission.state}→${to}`);
      return { success: false, error: validation.reason };
    }

    const fromState = mission.state;
    const now = Date.now();

    // Constitution check for critical transitions
    try {
      const cr = getConstitutionRuntime();
      const constDecision = cr.evaluate({ action: "mission_transition", from_state: fromState, to_state: to });
      if (!constDecision.allowed && to === "executing") {
        return { success: false, error: `Constitution blocked transition: ${constDecision.reasons.join("; ")}` };
      }
    } catch (e) {
      // Constitution runtime not available — allow transition
      console.debug(`[MISSION] constitution check skipped: ${(e as Error).message}`);
    }

    // Auto-create checkpoint on pause
    if (to === "paused") {
      const cp = createCheckpoint({
        missionId: id,
        state: fromState,
        context: { goals: mission.context.goals },
        progress: mission.progress,
        completedTasks: [],
        toolCallsCount: mission.toolCallsTotal,
        tokensUsed: mission.tokensUsed,
        costDollars: mission.costDollars,
      });
      console.info(`[MISSION] checkpoint created id=${cp.id} mission=${id}`);
    }

    // State update
    mission.state = to;
    mission.updatedAt = now;

    if (to === "executing" && !mission.startedAt) mission.startedAt = now;
    if (to === "completed") mission.completedAt = now;
    if (to === "failed") mission.failedAt = now;
    if (to === "recovering") mission.recoveryCount++;

    // Timeline
    recordTimelineEntry({
      missionId: id,
      type: "state_change",
      actor: "mission-kernel",
      detail: reason || `Transition: ${fromState} → ${to}`,
      evidence: { from: fromState, to },
    });

    // Event Bus
    try {
      const eb = getEventBus();
      const eventType = to === "completed" ? "mission:completed" :
        to === "failed" ? "mission:failed" :
        to === "executing" ? "mission:started" :
        to === "paused" ? "mission:paused" :
        to === "cancelled" ? "mission:failed" :
        null;

      if (eventType) {
        eb.publish(eventType as any, {
          missionId: id,
          ...(to === "failed" || to === "cancelled" ? { error: reason || `Mission ${to}`, phase: fromState } : {}),
          ...(to === "completed" ? { result: {}, durationMs: now - (mission.startedAt || now) } : {}),
        }, { missionId: id, chatId: mission.context.chatId });
      }
    } catch (e) {
      console.debug(`[MISSION] event publish skipped: ${(e as Error).message}`);
    }

    console.info(`[MISSION] transition id=${id} ${fromState}→${to} reason=${reason || "none"}`);
    return { success: true };
  }

  start(id: string): { success: boolean; error?: string } {
    const mission = this.missions[id];
    if (!mission) return { success: false, error: `Mission '${id}' not found` };

    // Already executing
    if (mission.state === "executing") {
      return { success: true };
    }

    // Already in a terminal state
    if (isTerminalState(mission.state)) {
      return { success: false, error: `Mission '${id}' is in terminal state: ${mission.state}` };
    }

    // Paused/waiting/recovering — resume
    if (isActiveState(mission.state)) {
      return this.transition(id, "executing", "Started").success
        ? { success: true }
        : { success: false, error: "Cannot start mission in current state" };
    }

    // Created/approved → first go to planning, then executing
    const result1 = this.transition(id, "planning", "Beginning planning phase");
    if (!result1.success) return { success: false, error: result1.error };

    const result2 = this.transition(id, "executing", "Mission started");
    return { success: result2.success, error: result2.error };
  }

  pause(id: string, reason?: string): { success: boolean; error?: string } {
    return this.transition(id, "paused", reason || "Paused by user");
  }

  resume(id: string): { success: boolean; error?: string; checkpoint?: MissionCheckpoint } {
    const result = this.transition(id, "executing", "Resumed");
    if (result.success) {
      const cp = getLatestCheckpoint(id);
      if (cp) restoreCheckpoint(cp.id);
      return { ...result, checkpoint: cp || undefined };
    }
    return result;
  }

  complete(id: string, evidence?: Record<string, unknown>): { success: boolean; error?: string } {
    const mission = this.missions[id];
    if (!mission) return { success: false, error: `Mission '${id}' not found` };

    this.addEvidence(id, {
      id: `ev-${randomUUID()}`,
      type: "completion",
      source: "mission-kernel",
      confidence: 1.0,
      timestamp: Date.now(),
      data: evidence || {},
    });

    mission.progress = 100;
    return this.transition(id, "completed", "All goals achieved");
  }

  fail(id: string, error: string, evidence?: Record<string, unknown>): { success: boolean; error?: string } {
    const mission = this.missions[id];
    if (!mission) return { success: false, error: `Mission '${id}' not found` };

    mission.error = error;

    if (evidence) {
      this.addEvidence(id, {
        id: `ev-${randomUUID()}`,
        type: "failure",
        source: "mission-kernel",
        confidence: 1.0,
        timestamp: Date.now(),
        data: evidence,
      });
    }

    recordTimelineEntry({
      missionId: id,
      type: "error",
      detail: error,
      evidence,
    });

    return this.transition(id, "failed", error);
  }

  cancel(id: string, reason?: string): { success: boolean; error?: string } {
    return this.transition(id, "cancelled", reason || "Cancelled by user");
  }

  // ── RECOVERY ─────────────────────────────────────────

  recover(id: string): { success: boolean; error?: string; checkpoint?: MissionCheckpoint } {
    const mission = this.missions[id];
    if (!mission) return { success: false, error: `Mission '${id}' not found` };

    // Try to restore from latest checkpoint
    const latestCp = getLatestCheckpoint(id);

    const result = this.transition(id, "recovering", "Recovery initiated");
    if (!result.success) return { success: false, error: result.error };

    // After recovery state, attempt to resume
    this.transition(id, "executing", "Recovery successful — resuming execution");

    recordTimelineEntry({
      missionId: id,
      type: "recovery",
      detail: `Recovered from state '${mission.state}' with ${latestCp ? `checkpoint ${latestCp.id}` : "no checkpoint"}`,
    });

    if (latestCp) {
      restoreCheckpoint(latestCp.id);
    }

    return { success: true, checkpoint: latestCp || undefined };
  }

  // ── EVIDENCE ─────────────────────────────────────────

  addEvidence(missionId: string, evidence: MissionEvidence): void {
    recordTimelineEntry({
      missionId,
      type: "evidence",
      detail: `Evidence collected: ${evidence.type}`,
      evidence: evidence.data,
      correlationId: evidence.correlationId,
    });
  }

  getEvidence(missionId: string): TimelineEntry[] {
    return getTimelineByType(missionId, "evidence");
  }

  // ── GOALS ────────────────────────────────────────────

  addGoal(missionId: string, description: string): MissionGoal | null {
    const mission = this.missions[missionId];
    if (!mission) return null;

    const goal: MissionGoal = {
      id: `goal-${randomUUID()}`,
      description,
      status: "pending",
    };

    mission.context.goals.push(goal);
    recordTimelineEntry({
      missionId,
      type: "plan_step",
      detail: `Goal added: ${description}`,
    });

    return goal;
  }

  updateGoal(missionId: string, goalId: string, update: Partial<MissionGoal>): boolean {
    const mission = this.missions[missionId];
    if (!mission) return false;

    const goal = mission.context.goals.find(g => g.id === goalId);
    if (!goal) return false;

    Object.assign(goal, update);

    if (update.status === "completed") {
      // Recalculate progress
      const total = mission.context.goals.length;
      const completed = mission.context.goals.filter(g => g.status === "completed").length;
      mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

      recordTimelineEntry({
        missionId,
        type: "plan_step",
        detail: `Goal completed: ${goal.description}`,
        evidence: update.evidence,
      });
    }

    return true;
  }

  // ── CHECKPOINTS ──────────────────────────────────────

  saveCheckpoint(missionId: string, input?: Partial<CreateCheckpointInput>): MissionCheckpoint | null {
    const mission = this.missions[missionId];
    if (!mission) return null;

    return createCheckpoint({
      missionId,
      state: mission.state,
      context: { goals: mission.context.goals, constraints: mission.context.constraints },
      progress: mission.progress,
      toolCallsCount: mission.toolCallsTotal,
      tokensUsed: mission.tokensUsed,
      costDollars: mission.costDollars,
      ...input,
    });
  }

  getCheckpoint(checkpointId: string): MissionCheckpoint | null {
    return loadCheckpoint(checkpointId);
  }

  getLatestCheckpoint(missionId: string): MissionCheckpoint | null {
    return getLatestCheckpoint(missionId);
  }

  getCheckpoints(missionId: string, limit?: number): MissionCheckpoint[] {
    return require("./checkpoint").getCheckpoints(missionId, limit || 20);
  }

  verifyCheckpoint(checkpointId: string): { valid: boolean; actual: string; expected: string } {
    return verifyCheckpointIntegrity(checkpointId);
  }

  // ── TIMELINE ─────────────────────────────────────────

  getTimeline(missionId: string, limit?: number): TimelineEntry[] {
    return getTimeline(missionId, limit || 100);
  }

  recordEvent(missionId: string, type: TimelineEntry["type"], detail: string, evidence?: Record<string, unknown>): void {
    recordTimelineEntry({
      missionId,
      type,
      detail,
      evidence,
    });
  }

  // ── STATS ────────────────────────────────────────────

  updateStats(missionId: string, stats: { toolCalls?: number; tokens?: number; cost?: number }): void {
    const mission = this.missions[missionId];
    if (!mission) return;

    if (stats.toolCalls) mission.toolCallsTotal += stats.toolCalls;
    if (stats.tokens) mission.tokensUsed += stats.tokens;
    if (stats.cost) mission.costDollars += stats.cost;
    mission.updatedAt = Date.now();
  }

  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    archived: number;
    totalToolCalls: number;
    totalTokens: number;
    totalCost: number;
  } {
    const all = Object.values(this.missions);
    return {
      total: all.length,
      active: all.filter(m => isActiveState(m.state)).length,
      completed: all.filter(m => m.state === "completed").length,
      failed: all.filter(m => m.state === "failed").length,
      cancelled: all.filter(m => m.state === "cancelled").length,
      archived: all.filter(m => m.state === "archived").length,
      totalToolCalls: all.reduce((s, m) => s + m.toolCallsTotal, 0),
      totalTokens: all.reduce((s, m) => s + m.tokensUsed, 0),
      totalCost: all.reduce((s, m) => s + m.costDollars, 0),
    };
  }

  getStatus(id: string): {
    exists: boolean;
    state?: MissionState;
    progress?: number;
    availableTransitions?: string[];
    timelineCount?: number;
    checkpointCount?: number;
  } {
    const mission = this.missions[id];
    if (!mission) return { exists: false };

    return {
      exists: true,
      state: mission.state,
      progress: mission.progress,
      availableTransitions: getAvailableTransitions(mission.state).map(t => t.to),
      timelineCount: getTimelineCount(id),
      checkpointCount: require("./checkpoint").getCheckpoints(id).length,
    };
  }
}

// ── SINGLETON ────────────────────────────────────────

let kernelInstance: MissionKernel | null = null;

export function getMissionKernel(): MissionKernel {
  if (!kernelInstance) {
    kernelInstance = new MissionKernel();
    kernelInstance.init();
  }
  return kernelInstance;
}

export function resetMissionKernel(): void {
  kernelInstance = null;
}
