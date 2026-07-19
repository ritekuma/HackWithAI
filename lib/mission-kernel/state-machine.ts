// @module mission-kernel/state-machine v1.0.0 — Formal Mission State Machine

export type MissionState =
  | "created"
  | "planning"
  | "approved"
  | "executing"
  | "waiting"
  | "paused"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export interface StateTransition {
  from: MissionState;
  to: MissionState;
  requiresApproval: boolean;
  requiresEvidence: boolean;
  description: string;
}

const TRANSITIONS: StateTransition[] = [
  { from: "created", to: "planning", requiresApproval: false, requiresEvidence: false, description: "Start planning the mission" },
  { from: "created", to: "cancelled", requiresApproval: false, requiresEvidence: false, description: "Cancel before planning" },
  { from: "planning", to: "approved", requiresApproval: true, requiresEvidence: true, description: "Plan approved for execution" },
  { from: "planning", to: "executing", requiresApproval: false, requiresEvidence: false, description: "Skip approval, go straight to execution" },
  { from: "planning", to: "cancelled", requiresApproval: false, requiresEvidence: false, description: "Cancel during planning" },
  { from: "approved", to: "executing", requiresApproval: false, requiresEvidence: false, description: "Begin mission execution" },
  { from: "approved", to: "cancelled", requiresApproval: true, requiresEvidence: false, description: "Cancel approved mission" },
  { from: "executing", to: "waiting", requiresApproval: false, requiresEvidence: false, description: "Waiting for external input or condition" },
  { from: "executing", to: "paused", requiresApproval: false, requiresEvidence: false, description: "Pause execution (checkpoint created)" },
  { from: "executing", to: "recovering", requiresApproval: false, requiresEvidence: false, description: "Recovery triggered by fault detection" },
  { from: "executing", to: "completed", requiresApproval: false, requiresEvidence: true, description: "All goals met successfully" },
  { from: "executing", to: "failed", requiresApproval: false, requiresEvidence: true, description: "Mission failed irrecoverably" },
  { from: "executing", to: "cancelled", requiresApproval: true, requiresEvidence: false, description: "Cancel running mission" },
  { from: "waiting", to: "executing", requiresApproval: false, requiresEvidence: false, description: "Resume after waiting condition met" },
  { from: "waiting", to: "paused", requiresApproval: false, requiresEvidence: false, description: "Pause while waiting" },
  { from: "waiting", to: "cancelled", requiresApproval: true, requiresEvidence: false, description: "Cancel while waiting" },
  { from: "paused", to: "executing", requiresApproval: false, requiresEvidence: false, description: "Resume from paused state" },
  { from: "paused", to: "cancelled", requiresApproval: true, requiresEvidence: false, description: "Cancel paused mission" },
  { from: "paused", to: "failed", requiresApproval: false, requiresEvidence: true, description: "Fail while paused (e.g., data corruption)" },
  { from: "recovering", to: "executing", requiresApproval: false, requiresEvidence: false, description: "Recovery successful, resume execution" },
  { from: "recovering", to: "failed", requiresApproval: false, requiresEvidence: true, description: "Recovery failed, mission lost" },
  { from: "recovering", to: "paused", requiresApproval: false, requiresEvidence: false, description: "Pause during recovery" },
  { from: "completed", to: "archived", requiresApproval: false, requiresEvidence: false, description: "Archive completed mission" },
  { from: "failed", to: "archived", requiresApproval: false, requiresEvidence: false, description: "Archive failed mission" },
  { from: "failed", to: "recovering", requiresApproval: false, requiresEvidence: true, description: "Attempt recovery from failed state" },
  { from: "cancelled", to: "archived", requiresApproval: false, requiresEvidence: false, description: "Archive cancelled mission" },
];

export function isValidTransition(from: MissionState, to: MissionState): boolean {
  return TRANSITIONS.some(t => t.from === from && t.to === to);
}

export function getTransition(from: MissionState, to: MissionState): StateTransition | undefined {
  return TRANSITIONS.find(t => t.from === from && t.to === to);
}

export function getAvailableTransitions(from: MissionState): StateTransition[] {
  return TRANSITIONS.filter(t => t.from === from);
}

export interface TransitionResult {
  allowed: boolean;
  from: MissionState;
  to: MissionState;
  reason: string;
  requiresApproval: boolean;
  requiresEvidence: boolean;
}

export function validateTransition(from: MissionState, to: MissionState): TransitionResult {
  const transition = getTransition(from, to);

  if (!transition) {
    return {
      allowed: false,
      from,
      to,
      reason: `Invalid transition: ${from} → ${to}`,
      requiresApproval: false,
      requiresEvidence: false,
    };
  }

  return {
    allowed: true,
    from,
    to,
    reason: transition.description,
    requiresApproval: transition.requiresApproval,
    requiresEvidence: transition.requiresEvidence,
  };
}

export function isTerminalState(state: MissionState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "archived";
}

export function isActiveState(state: MissionState): boolean {
  return state === "executing" || state === "recovering" || state === "waiting" || state === "paused";
}
