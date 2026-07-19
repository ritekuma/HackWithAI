// @module mission-kernel v1.0.0 — Unified Mission Kernel public API

export { getMissionKernel, resetMissionKernel } from "./mission-kernel";
export type {
  MissionPriority,
  MissionDefinition,
  MissionContext,
  MissionGoal,
  MissionEvidence,
} from "./mission-kernel";

export {
  isValidTransition,
  getTransition,
  getAvailableTransitions,
  validateTransition,
  isTerminalState,
  isActiveState,
} from "./state-machine";
export type { MissionState, StateTransition, TransitionResult } from "./state-machine";

export {
  recordTimelineEntry,
  getTimeline,
  getTimelineByType,
  getTimelineCount,
  cleanOldTimelines,
} from "./timeline";
export type { TimelineEntry } from "./timeline";

export {
  createCheckpoint,
  loadCheckpoint,
  getLatestCheckpoint,
  getCheckpoints,
  restoreCheckpoint,
  verifyCheckpointIntegrity,
  invalidateCheckpoint,
  cleanOldCheckpoints,
} from "./checkpoint";
export type { MissionCheckpoint, CreateCheckpointInput } from "./checkpoint";
