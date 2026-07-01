// ── Mission Engine ──
// Executes long-running missions by orchestrating existing agents, memory, and tools.

import type {
  MissionDefinition, MissionStatus, MissionPlan, MissionCheckpoint,
  MissionLogEntry, MissionMetrics,
} from "./types";
import { planMission } from "./planner";
import { getOrchestrator } from "@/lib/orchestration/bootstrap";
import { getMemory } from "@/lib/memory/bootstrap";

function missionId(): string {
  return `mission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export class MissionEngine {
  private missions = new Map<string, MissionDefinition>();
  private logBuffer = new Map<string, MissionLogEntry[]>();
  private startTime = Date.now();

  // ── Lifecycle ───────────────────────────────────────

  create(title: string, objective: string, priority: MissionDefinition["priority"] = "medium", owner = "system"): MissionDefinition {
    const mission: MissionDefinition = {
      id: missionId(),
      title,
      objective,
      priority,
      owner,
      status: "pending",
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionPolicy: "balanced",
      approvalMode: "auto_approve",
      budget: 10.0,
      costSoFar: 0,
      childMissionIds: [],
      goals: [],
      checkpoints: [],
      logs: [],
      tags: [],
    };

    this.missions.set(mission.id, mission);
    this.log(mission, "info", `Mission created: ${title}`);
    return mission;
  }

  async start(missionId: string): Promise<MissionDefinition> {
    const mission = this.require(missionId);
    if (mission.status !== "pending" && mission.status !== "paused") {
      throw new Error(`Cannot start mission in status: ${mission.status}`);
    }

    // Phase 1: Plan
    mission.status = "planning";
    this.log(mission, "info", "Planning mission...");
    const plan = planMission(mission);
    mission.goals = plan.goals;
    mission.updatedAt = Date.now();
    this.log(mission, "success", `Plan created: ${plan.goals.length} goals, ${plan.requiredAgents.length} agents, ~${plan.estimatedDuration}s, ~$${plan.estimatedCost}`);

    // Phase 2: Retrieve memory context
    mission.status = "executing";
    const memory = getMemory();
    try {
      await memory.beforeTask({
        id: mission.id,
        description: mission.objective,
        teamId: "full-pipeline",
        status: "running",
        steps: [],
        createdAt: mission.createdAt,
      });
      this.log(mission, "info", "Memory context retrieved");
    } catch { /* non-critical */ }

    // Phase 3: Execute goals sequentially through orchestrator
    let completed = 0;
    const totalTasks = mission.goals.reduce((s, g) => s + g.milestones.reduce((ss, m) => ss + m.tasks.length, 0), 0);

    for (const goal of mission.goals) {
      goal.status = "in_progress";
      for (const milestone of goal.milestones) {
        milestone.status = "in_progress";
        for (const task of milestone.tasks) {
          if (task.dependencies.length > 0) {
            const unmet = task.dependencies.filter((d) => {
              for (const g of mission.goals) {
                for (const m of g.milestones) {
                  const t = m.tasks.find((x) => x.id === d);
                  if (t && t.status !== "completed") return true;
                }
              }
              return false;
            });
            if (unmet.length > 0) {
              task.status = "pending";
              continue;
            }
          }

          task.status = "running";
          this.log(mission, "info", `Executing: ${task.agentId} → ${task.description.slice(0, 80)}`);

          try {
            const orchestrator = getOrchestrator();
            const orchTask = await orchestrator.execute(task.description, task.teamId);
            task.orchestrationTaskId = orchTask.id;
            task.status = orchTask.status === "completed" ? "completed" : "failed";
            task.actualDuration = (orchTask.completedAt || Date.now()) - (orchTask.createdAt || Date.now());
            mission.costSoFar += 0.02;
            completed++;

            this.log(mission, task.status === "completed" ? "success" : "error",
              `${task.agentId}: ${task.status} (${task.actualDuration}ms)`);
          } catch (e) {
            task.status = "failed";
            this.log(mission, "error", `${task.agentId}: ${e instanceof Error ? e.message : "failed"}`);
          }

          // Update progress
          mission.progress = Math.round((completed / totalTasks) * 100);
          mission.updatedAt = Date.now();

          // Checkpoint every 3 tasks
          if (completed % 3 === 0) {
            this.checkpoint(mission);
          }
        }
        milestone.status = milestone.tasks.every((t) => t.status === "completed") ? "completed" : "failed";
      }
      goal.status = goal.milestones.every((m) => m.status === "completed") ? "completed" : "failed";
    }

    // Phase 4: Store experiences
    try {
      await memory.afterTask({
        id: mission.id,
        description: mission.objective,
        teamId: "full-pipeline",
        status: "completed",
        steps: [],
        createdAt: mission.createdAt,
        completedAt: Date.now(),
        finalOutput: JSON.stringify({ goals: mission.goals.length, progress: mission.progress }),
      });
    } catch {}

    // Final
    const allDone = mission.goals.every((g) => g.status === "completed");
    mission.status = allDone ? "completed" : "failed";
    mission.updatedAt = Date.now();
    this.log(mission, allDone ? "success" : "error", `Mission ${mission.status}. Progress: ${mission.progress}%`);

    return mission;
  }

  pause(missionId: string): void {
    const m = this.require(missionId);
    if (m.status !== "executing") throw new Error("Only executing missions can be paused");
    m.status = "paused";
    this.checkpoint(m);
    this.log(m, "warn", "Mission paused");
  }

  resume(missionId: string): Promise<MissionDefinition> {
    const m = this.require(missionId);
    if (m.status !== "paused") throw new Error("Only paused missions can be resumed");
    return this.start(missionId);
  }

  cancel(missionId: string): void {
    const m = this.require(missionId);
    m.status = "cancelled";
    m.updatedAt = Date.now();
    this.log(m, "warn", "Mission cancelled");
  }

  async retry(missionId: string): Promise<MissionDefinition> {
    const m = this.require(missionId);
    if (m.status !== "failed") throw new Error("Only failed missions can be retried");
    // Rollback to last checkpoint
    const lastCheck = m.checkpoints[m.checkpoints.length - 1];
    if (lastCheck) {
      this.log(m, "info", `Rolling back to checkpoint ${lastCheck.id}`);
    }
    m.status = "pending";
    m.progress = 0;
    return this.start(missionId);
  }

  // ── Checkpoints ─────────────────────────────────────

  private checkpoint(mission: MissionDefinition): MissionCheckpoint {
    const cp: MissionCheckpoint = {
      id: `cp-${mission.id}-${Date.now()}`,
      missionId: mission.id,
      timestamp: Date.now(),
      state: mission.status,
      completedTaskIds: mission.goals.flatMap((g) => g.milestones.flatMap((m) => m.tasks.filter((t) => t.status === "completed").map((t) => t.id))),
      memorySnapshots: [],
      canRollback: true,
    };
    mission.checkpoints.push(cp);
    return cp;
  }

  // ── Queries ─────────────────────────────────────────

  get(missionId: string): MissionDefinition | undefined {
    return this.missions.get(missionId);
  }

  list(status?: MissionStatus): MissionDefinition[] {
    const all = Array.from(this.missions.values());
    return status ? all.filter((m) => m.status === status) : all;
  }

  getTimeline(missionId: string): MissionLogEntry[] {
    return this.missions.get(missionId)?.logs || [];
  }

  getLogs(missionId: string, limit = 50): MissionLogEntry[] {
    const logs = this.missions.get(missionId)?.logs || [];
    return logs.slice(-limit);
  }

  metrics(): MissionMetrics {
    const all = Array.from(this.missions.values());
    const completed = all.filter((m) => m.status === "completed");
    const failed = all.filter((m) => m.status === "failed");
    return {
      totalMissions: all.length,
      completed: completed.length,
      failed: failed.length,
      active: all.filter((m) => m.status === "executing" || m.status === "planning").length,
      averageCompletionTime: completed.length > 0
        ? completed.reduce((s, m) => s + (m.updatedAt - m.createdAt), 0) / completed.length / 1000
        : 0,
      averageCost: all.length > 0 ? all.reduce((s, m) => s + m.costSoFar, 0) / all.length : 0,
      successRate: all.length > 0 ? completed.length / all.length : 0,
      byPriority: {},
      recentFailures: failed.slice(-5).map((m) => m.title),
    };
  }

  // ── Internal ────────────────────────────────────────

  private require(id: string): MissionDefinition {
    const m = this.missions.get(id);
    if (!m) throw new Error(`Mission '${id}' not found`);
    return m;
  }

  private log(mission: MissionDefinition, level: MissionLogEntry["level"], message: string, taskId?: string, agentId?: string): void {
    const entry: MissionLogEntry = { timestamp: Date.now(), level, message, taskId, agentId };
    mission.logs.push(entry);
  }
}
