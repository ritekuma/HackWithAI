// ── Mission Types ──
// Long-running autonomous objectives.

import type { ExecutionPolicy } from "@/lib/orchestration/policies";
import type { ExperienceRecord } from "@/lib/memory/types";

export type MissionStatus =
  | "pending"
  | "planning"
  | "executing"
  | "waiting"
  | "paused"
  | "needs_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalMode = "always_ask" | "never_ask" | "auto_approve" | "by_tool" | "by_cost" | "by_risk";

export interface MissionGoal {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  milestones: MissionMilestone[];
}

export interface MissionMilestone {
  id: string;
  goalId: string;
  description: string;
  order: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  tasks: MissionTask[];
  checkpointId?: string;
}

export interface MissionTask {
  id: string;
  milestoneId: string;
  description: string;
  teamId: string;
  agentId?: string;
  status: "pending" | "running" | "completed" | "failed";
  dependencies: string[];   // task IDs that must complete first
  estimatedDuration: number; // seconds
  actualDuration?: number;
  orchestrationTaskId?: string;
}

export interface MissionCheckpoint {
  id: string;
  missionId: string;
  timestamp: number;
  state: MissionStatus;
  completedTaskIds: string[];
  memorySnapshots: string[];
  canRollback: boolean;
}

export interface MissionDefinition {
  id: string;
  title: string;
  objective: string;
  priority: "low" | "medium" | "high" | "critical";
  owner: string;
  status: MissionStatus;
  progress: number;          // 0-100
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  executionPolicy: ExecutionPolicy;
  approvalMode: ApprovalMode;
  budget: number;            // USD
  costSoFar: number;
  parentMissionId?: string;
  childMissionIds: string[];
  goals: MissionGoal[];
  checkpoints: MissionCheckpoint[];
  logs: MissionLogEntry[];
  tags: string[];
}

export interface MissionLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  taskId?: string;
  agentId?: string;
  cost?: number;
}

export interface MissionPlan {
  missionId: string;
  goals: MissionGoal[];
  estimatedCost: number;
  estimatedDuration: number;  // seconds
  requiredAgents: string[];
  requiredTools: string[];
  risks: string[];
}

export interface MissionMetrics {
  totalMissions: number;
  completed: number;
  failed: number;
  active: number;
  averageCompletionTime: number;
  averageCost: number;
  successRate: number;
  byPriority: Record<string, number>;
  recentFailures: string[];
}
