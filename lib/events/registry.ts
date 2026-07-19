// @module events/registry v1.0.0 — Enterprise Event Registry

import type { EventContract } from "./types";

const registry = new Map<string, EventContract>();

export function registerEvent(contract: EventContract): void {
  if (registry.has(contract.type)) {
    console.warn(`[EVENT] re-registering event type=${contract.type}`);
  }
  registry.set(contract.type, contract);
}

export function getEventContract(type: string): EventContract | undefined {
  return registry.get(type);
}

export function getAllEventContracts(): EventContract[] {
  return Array.from(registry.values());
}

export function getEventsByCategory(category: string): EventContract[] {
  return Array.from(registry.values()).filter(c => c.category === category);
}

export function isEventRegistered(type: string): boolean {
  return registry.has(type);
}

// ── MISSION EVENTS ──────────────────────────────────────────────

registerEvent({
  type: "mission:created",
  category: "mission",
  description: "A new mission has been created",
  version: "1.0.0",
  schema: { missionId: "string", name: "string", goal: "string" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "mission:started",
  category: "mission",
  description: "Mission execution has started",
  version: "1.0.0",
  schema: { missionId: "string" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "mission:completed",
  category: "mission",
  description: "Mission completed successfully",
  version: "1.0.0",
  schema: { missionId: "string", result: "object", durationMs: "number" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "mission:failed",
  category: "mission",
  description: "Mission failed",
  version: "1.0.0",
  schema: { missionId: "string", error: "string", phase: "string" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "mission:paused",
  category: "mission",
  description: "Mission execution paused",
  version: "1.0.0",
  schema: { missionId: "string", reason: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "mission:resumed",
  category: "mission",
  description: "Mission execution resumed from pause",
  version: "1.0.0",
  schema: { missionId: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "mission:phase:started",
  category: "mission",
  description: "A mission phase has started",
  version: "1.0.0",
  schema: { missionId: "string", phase: "string", phaseIndex: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "mission:phase:completed",
  category: "mission",
  description: "A mission phase completed",
  version: "1.0.0",
  schema: { missionId: "string", phase: "string", durationMs: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

// ── TOOL EVENTS ─────────────────────────────────────────────────

registerEvent({
  type: "tool:requested",
  category: "tool",
  description: "A tool execution was requested by the AI",
  version: "1.0.0",
  schema: { toolName: "string", args: "object", chatId: "string" },
  persistent: true,
  replayable: true,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "tool:started",
  category: "tool",
  description: "Tool execution has started",
  version: "1.0.0",
  schema: { toolName: "string", toolCallId: "string", chatId: "string" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "tool:completed",
  category: "tool",
  description: "Tool execution completed successfully",
  version: "1.0.0",
  schema: { toolName: "string", toolCallId: "string", durationMs: "number", result: "object" },
  persistent: true,
  replayable: true,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "tool:failed",
  category: "tool",
  description: "Tool execution failed",
  version: "1.0.0",
  schema: { toolName: "string", toolCallId: "string", error: "string", retryCount: "number" },
  persistent: true,
  replayable: false,
  auditable: false,
  critical: true,
});

registerEvent({
  type: "tool:retried",
  category: "tool",
  description: "Tool execution was retried after failure",
  version: "1.0.0",
  schema: { toolName: "string", toolCallId: "string", attempt: "number" },
  persistent: true,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "tool:recovered",
  category: "tool",
  description: "Tool execution recovered from failure",
  version: "1.0.0",
  schema: { toolName: "string", toolCallId: "string", attempts: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

// ── EXECUTIVE EVENTS ────────────────────────────────────────────

registerEvent({
  type: "executive:assigned",
  category: "executive",
  description: "An executive was assigned to a mission/chat",
  version: "1.0.0",
  schema: { executiveId: "string", executiveName: "string", missionId: "string", chatId: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "executive:decision",
  category: "executive",
  description: "An executive made a decision",
  version: "1.0.0",
  schema: { executiveId: "string", decision: "string", reasoning: "string", confidence: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "executive:completed",
  category: "executive",
  description: "Executive completed its work",
  version: "1.0.0",
  schema: { executiveId: "string", durationMs: "number", outcome: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "executive:error",
  category: "executive",
  description: "Executive encountered an error",
  version: "1.0.0",
  schema: { executiveId: "string", error: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "executive:vote",
  category: "executive",
  description: "Executive cast a vote on a decision",
  version: "1.0.0",
  schema: { executiveId: "string", proposal: "string", vote: "approve|reject|abstain" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

// ── RECOVERY EVENTS ─────────────────────────────────────────────

registerEvent({
  type: "recovery:started",
  category: "recovery",
  description: "Recovery process started",
  version: "1.0.0",
  schema: { faultType: "string", target: "string", chatId: "string" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "recovery:completed",
  category: "recovery",
  description: "Recovery process completed successfully",
  version: "1.0.0",
  schema: { faultType: "string", durationMs: "number", statePreserved: "boolean" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "recovery:failed",
  category: "recovery",
  description: "Recovery process failed",
  version: "1.0.0",
  schema: { faultType: "string", error: "string", attempts: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: true,
});

registerEvent({
  type: "recovery:fault:detected",
  category: "recovery",
  description: "A fault was detected by the recovery system",
  version: "1.0.0",
  schema: { faultType: "string", target: "string", severity: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: true,
});

// ── MEMORY EVENTS ───────────────────────────────────────────────

registerEvent({
  type: "memory:stored",
  category: "memory",
  description: "New memory entity created or updated",
  version: "1.0.0",
  schema: { entityName: "string", entityType: "string", observationCount: "number" },
  persistent: true,
  replayable: true,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "memory:retrieved",
  category: "memory",
  description: "Memory entities were retrieved",
  version: "1.0.0",
  schema: { query: "string", resultCount: "number", durationMs: "number" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "memory:conflict",
  category: "memory",
  description: "Memory conflict detected",
  version: "1.0.0",
  schema: { entityName: "string", conflictType: "string", resolution: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "memory:deleted",
  category: "memory",
  description: "Memory entity deleted",
  version: "1.0.0",
  schema: { entityName: "string", entityType: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

// ── WORKSPACE EVENTS ────────────────────────────────────────────

registerEvent({
  type: "workspace:loaded",
  category: "workspace",
  description: "Workspace was loaded/created for a session",
  version: "1.0.0",
  schema: { workspaceId: "string", chatId: "string", cwd: "string" },
  persistent: true,
  replayable: true,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "workspace:saved",
  category: "workspace",
  description: "Workspace state was persisted",
  version: "1.0.0",
  schema: { workspaceId: "string", fileCount: "number", sizeBytes: "number" },
  persistent: true,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "workspace:file:created",
  category: "workspace",
  description: "File created in workspace",
  version: "1.0.0",
  schema: { workspaceId: "string", filePath: "string", sizeBytes: "number" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "workspace:file:modified",
  category: "workspace",
  description: "File modified in workspace",
  version: "1.0.0",
  schema: { workspaceId: "string", filePath: "string", changeSize: "number" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "workspace:command:executed",
  category: "workspace",
  description: "Shell command executed in workspace",
  version: "1.0.0",
  schema: { workspaceId: "string", command: "string", exitCode: "number", durationMs: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

// ── SIMULATION EVENTS ───────────────────────────────────────────

registerEvent({
  type: "simulation:started",
  category: "simulation",
  description: "A simulation has started",
  version: "1.0.0",
  schema: { simulationId: "string", type: "string", parameters: "object" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "simulation:finished",
  category: "simulation",
  description: "A simulation has finished",
  version: "1.0.0",
  schema: { simulationId: "string", outcome: "string", results: "object" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "simulation:step",
  category: "simulation",
  description: "A simulation step was executed",
  version: "1.0.0",
  schema: { simulationId: "string", step: "number", state: "object" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

// ── SYSTEM EVENTS ───────────────────────────────────────────────

registerEvent({
  type: "system:startup",
  category: "system",
  description: "System has started up",
  version: "1.0.0",
  schema: { version: "string", mode: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "system:shutdown",
  category: "system",
  description: "System is shutting down",
  version: "1.0.0",
  schema: { reason: "string", uptimeMs: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "system:health",
  category: "system",
  description: "Health check result",
  version: "1.0.0",
  schema: { status: "string", subsystems: "object" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "system:error",
  category: "system",
  description: "System-level error occurred",
  version: "1.0.0",
  schema: { error: "string", component: "string", severity: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: true,
});

// ── CHAT EVENTS ─────────────────────────────────────────────────

registerEvent({
  type: "chat:created",
  category: "chat",
  description: "A new chat session was created",
  version: "1.0.0",
  schema: { chatId: "string", mode: "string", userId: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "chat:message:sent",
  category: "chat",
  description: "A user message was sent",
  version: "1.0.0",
  schema: { chatId: "string", messageId: "string", length: "number" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "chat:response:started",
  category: "chat",
  description: "AI response generation started",
  version: "1.0.0",
  schema: { chatId: "string", model: "string", mode: "string" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "chat:response:completed",
  category: "chat",
  description: "AI response generation completed",
  version: "1.0.0",
  schema: { chatId: "string", tokensTotal: "number", durationMs: "number" },
  persistent: true,
  replayable: false,
  auditable: false,
  critical: false,
});

// ── AGENT EVENTS ────────────────────────────────────────────────

registerEvent({
  type: "agent:task:created",
  category: "agent",
  description: "A background agent task was created",
  version: "1.0.0",
  schema: { taskId: "string", type: "string", chatId: "string" },
  persistent: true,
  replayable: true,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "agent:task:started",
  category: "agent",
  description: "A background agent task started execution",
  version: "1.0.0",
  schema: { taskId: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "agent:task:completed",
  category: "agent",
  description: "A background agent task completed",
  version: "1.0.0",
  schema: { taskId: "string", result: "object", durationMs: "number" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: false,
});

registerEvent({
  type: "agent:task:failed",
  category: "agent",
  description: "A background agent task failed",
  version: "1.0.0",
  schema: { taskId: "string", error: "string" },
  persistent: true,
  replayable: false,
  auditable: true,
  critical: true,
});

// ── TELEMETRY EVENTS ────────────────────────────────────────────

registerEvent({
  type: "telemetry:metric",
  category: "telemetry",
  description: "A telemetry metric was recorded",
  version: "1.0.0",
  schema: { name: "string", value: "number", unit: "string" },
  persistent: false,
  replayable: false,
  auditable: false,
  critical: false,
});

registerEvent({
  type: "telemetry:cost",
  category: "telemetry",
  description: "API cost was recorded",
  version: "1.0.0",
  schema: { model: "string", tokens: "number", costDollars: "number" },
  persistent: true,
  replayable: false,
  auditable: false,
  critical: false,
});

console.info(`[EVENT] registry initialized events=${registry.size}`);
