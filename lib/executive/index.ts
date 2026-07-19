// @module executive v1.0.0 — Executive Runtime public API

export { ExecutiveRuntime } from "./executive-runtime";
export type { ExecutiveId, BoardConfig, BoardReviewResult } from "./executive-runtime";

export { getDecisionEngine, resetDecisionEngine } from "./decision-engine";
export type {
  Decision,
  DecisionType,
  DecisionVote,
  DecisionConfidence,
  DecisionStatus,
  DecisionTimelineEntry,
} from "./decision-engine";

export {
  assignWorker,
  completeWorkerTask,
  getDepartmentByRole,
  getAvailableWorker,
  findDepartmentForTool,
  findDepartmentForCapability,
  getDepartmentStats,
} from "./departments";
export type { Department, Worker, Assignment } from "./departments";
