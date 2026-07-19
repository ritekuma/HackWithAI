// @module mission-kernel/__tests__/mission-kernel.test.ts v1.0.0

import { getMissionKernel, resetMissionKernel } from "../mission-kernel";
import {
  isValidTransition,
  validateTransition,
  getAvailableTransitions,
  isTerminalState,
  isActiveState,
} from "../state-machine";
import { createCheckpoint, getLatestCheckpoint, verifyCheckpointIntegrity } from "../checkpoint";
import { recordTimelineEntry, getTimeline } from "../timeline";

let mk: ReturnType<typeof getMissionKernel>;

beforeEach(() => {
  resetMissionKernel();
  mk = getMissionKernel();
});

describe("State Machine", () => {
  test("valid transitions", () => {
    expect(isValidTransition("created", "planning")).toBe(true);
    expect(isValidTransition("executing", "paused")).toBe(true);
    expect(isValidTransition("executing", "completed")).toBe(true);
    expect(isValidTransition("executing", "failed")).toBe(true);
    expect(isValidTransition("paused", "executing")).toBe(true);
    expect(isValidTransition("recovering", "executing")).toBe(true);
    expect(isValidTransition("completed", "archived")).toBe(true);
    expect(isValidTransition("failed", "archived")).toBe(true);
    expect(isValidTransition("failed", "recovering")).toBe(true);
  });

  test("invalid transitions", () => {
    expect(isValidTransition("created", "executing")).toBe(false);
    expect(isValidTransition("completed", "executing")).toBe(false);
    expect(isValidTransition("failed", "executing")).toBe(false);
    expect(isValidTransition("archived", "anything" as any)).toBe(false);
    expect(isValidTransition("executing", "created")).toBe(false);
  });

  test("validate transition returns details", () => {
    const result = validateTransition("created", "planning");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);

    const invalid = validateTransition("completed", "executing");
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toContain("Invalid transition");
  });

  test("available transitions", () => {
    const created = getAvailableTransitions("created");
    expect(created.map(t => t.to).sort()).toEqual(["cancelled", "planning"]);

    const executing = getAvailableTransitions("executing");
    expect(executing.map(t => t.to)).toContain("paused");
    expect(executing.map(t => t.to)).toContain("completed");
    expect(executing.map(t => t.to)).toContain("failed");
    expect(executing.map(t => t.to)).toContain("recovering");
    expect(executing.map(t => t.to)).toContain("cancelled");
  });

  test("terminal states", () => {
    expect(isTerminalState("completed")).toBe(true);
    expect(isTerminalState("failed")).toBe(true);
    expect(isTerminalState("cancelled")).toBe(true);
    expect(isTerminalState("archived")).toBe(true);
    expect(isTerminalState("executing")).toBe(false);
    expect(isTerminalState("paused")).toBe(false);
  });

  test("active states", () => {
    expect(isActiveState("executing")).toBe(true);
    expect(isActiveState("recovering")).toBe(true);
    expect(isActiveState("waiting")).toBe(true);
    expect(isActiveState("paused")).toBe(true);
    expect(isActiveState("completed")).toBe(false);
  });
});
describe("Mission Kernel — Lifecycle", () => {
  test("full lifecycle: created → planning → executing → paused → executing → completed → archived", () => {
    const m = mk.create({ name: "Test Full Lifecycle" });
    expect(m.state).toBe("created");

    const start = mk.start(m.id);
    expect(start.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");

    const pause = mk.pause(m.id);
    expect(pause.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("paused");

    const resume = mk.resume(m.id);
    expect(resume.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");

    const complete = mk.complete(m.id);
    expect(complete.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("completed");
    expect(mk.get(m.id)!.progress).toBe(100);

    const archive = mk.transition(m.id, "archived");
    expect(archive.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("archived");
  });

  test("lifecycle: created → cancelled", () => {
    const m = mk.create({ name: "Cancel Me" });
    const result = mk.cancel(m.id);
    expect(result.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("cancelled");
  });

  test("lifecycle: executing → failed → archived", () => {
    const m = mk.create({ name: "Fail Me" });
    mk.start(m.id);

    const fail = mk.fail(m.id, "Critical error: out of memory");
    expect(fail.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("failed");
    expect(mk.get(m.id)!.error).toBe("Critical error: out of memory");

    mk.transition(m.id, "archived");
    expect(mk.get(m.id)!.state).toBe("archived");
  });

  test("lifecycle: executing → recovering → executing (recovery)", () => {
    const m = mk.create({ name: "Recovery Test" });
    mk.start(m.id);

    const recover = mk.recover(m.id);
    expect(recover.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");
  });

  test("invalid transition is rejected", () => {
    const m = mk.create({ name: "Invalid Transition Test" });
    const result = mk.transition(m.id, "executing"); // created cannot go directly to executing
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid transition");
    expect(mk.get(m.id)!.state).toBe("created");
  });
});

describe("Mission Kernel — CRUD", () => {
  test("create and retrieve", () => {
    const m = mk.create({ name: "Test Mission", type: "coding", priority: "high" });
    expect(m.name).toBe("Test Mission");
    expect(m.type).toBe("coding");
    expect(m.priority).toBe("high");
    expect(m.state).toBe("created");

    const retrieved = mk.get(m.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.id).toBe(m.id);
  });

  test("list and filter", () => {
    mk.create({ name: "Mission A", type: "coding" });
    mk.create({ name: "Mission B", type: "research" });
    const m3 = mk.create({ name: "Mission C", type: "coding" });
    mk.start(m3.id);

    expect(mk.list().length).toBe(3);
    expect(mk.list({ type: "coding" }).length).toBe(2);
    expect(mk.list({ state: "executing" }).length).toBe(1);
  });

  test("stats", () => {
    const m = mk.create({ name: "Stats Test" });
    mk.start(m.id);
    mk.updateStats(m.id, { toolCalls: 5, tokens: 1000, cost: 0.05 });

    const stats = mk.getStats();
    expect(stats.total).toBe(1);
    expect(stats.active).toBe(1);
    expect(stats.totalToolCalls).toBe(5);
    expect(stats.totalTokens).toBe(1000);
    expect(stats.totalCost).toBe(0.05);
  });
});

describe("Mission Kernel — Goals", () => {
  test("add and complete goals", () => {
    const m = mk.create({ name: "Goals Test" });
    mk.start(m.id);

    const g1 = mk.addGoal(m.id, "Write tests");
    const g2 = mk.addGoal(m.id, "Write docs");
    expect(g1).toBeTruthy();
    expect(g2).toBeTruthy();

    mk.updateGoal(m.id, g1!.id, { status: "completed" });
    expect(mk.get(m.id)!.progress).toBe(50);

    mk.updateGoal(m.id, g2!.id, { status: "completed" });
    expect(mk.get(m.id)!.progress).toBe(100);
  });

  test("goal status is tracked", () => {
    const m = mk.create({ name: "Goal Status" });
    mk.start(m.id);

    const g = mk.addGoal(m.id, "Do something");
    expect(g!.status).toBe("pending");

    mk.updateGoal(m.id, g!.id, { status: "in_progress" });
    const mission = mk.get(m.id)!;
    expect(mission.context.goals[0].status).toBe("in_progress");
  });
});

describe("Mission Kernel — Checkpoints", () => {
  test("auto checkpoint on pause", () => {
    const m = mk.create({ name: "Checkpoint on Pause" });
    mk.start(m.id);

    mk.pause(m.id);
    const cp = getLatestCheckpoint(m.id);

    expect(cp).toBeTruthy();
    expect(cp!.missionId).toBe(m.id);
    expect(cp!.state).toBe("executing");
  });

  test("manual checkpoint save", () => {
    const m = mk.create({ name: "Manual Checkpoint" });
    mk.start(m.id);
    mk.updateStats(m.id, { toolCalls: 10, tokens: 500 });

    const cp = mk.saveCheckpoint(m.id);
    expect(cp).toBeTruthy();
    expect(cp!.toolCallsCount).toBe(10);
    expect(cp!.tokensUsed).toBe(500);
  });

  test("checkpoint integrity", () => {
    const m = mk.create({ name: "Integrity Test" });
    mk.start(m.id);

    const cp = mk.saveCheckpoint(m.id);
    expect(cp).toBeTruthy();

    const result = verifyCheckpointIntegrity(cp!.id);
    expect(result.valid).toBe(true);
  });

  test("get checkpoints list", () => {
    const m = mk.create({ name: "Multi Checkpoint" });
    mk.start(m.id);

    mk.saveCheckpoint(m.id);
    mk.saveCheckpoint(m.id);
    mk.saveCheckpoint(m.id);

    const checkpoints = mk.getCheckpoints(m.id);
    expect(checkpoints.length).toBe(3);
  });
});

describe("Mission Kernel — Timeline", () => {
  test("timeline entries are recorded on transitions", () => {
    const m = mk.create({ name: "Timeline Test" });
    mk.start(m.id);
    mk.pause(m.id);
    mk.resume(m.id);
    mk.complete(m.id);

    const timeline = mk.getTimeline(m.id);
    expect(timeline.length).toBeGreaterThanOrEqual(5);
    expect(timeline.some(e => e.type === "state_change")).toBe(true);
  });

  test("evidence recording", () => {
    const m = mk.create({ name: "Evidence Test" });
    mk.start(m.id);

    mk.addEvidence(m.id, {
      id: "ev-1", type: "screenshot", source: "playwright",
      confidence: 0.95, timestamp: Date.now(), data: { url: "https://example.com" },
    });

    const evidence = mk.getEvidence(m.id);
    expect(evidence.length).toBe(1);
    expect(evidence[0].type).toBe("evidence");
  });

  test("error recording on failure", () => {
    const m = mk.create({ name: "Error Test" });
    mk.start(m.id);

    mk.fail(m.id, "Connection refused", { code: "ECONNREFUSED" });

    const timeline = mk.getTimeline(m.id);
    const errorEvents = timeline.filter(e => e.type === "error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].detail).toContain("Connection refused");
  });
});

describe("Mission Kernel — Concurrency", () => {
  test("multiple missions created simultaneously", () => {
    const missions = [];
    for (let i = 0; i < 50; i++) {
      missions.push(mk.create({ name: `Mission ${i}` }));
    }

    expect(mk.count()).toBe(50);
    expect(new Set(missions.map(m => m.id)).size).toBe(50); // All unique IDs
  });

  test("rapid state transitions do not corrupt state", () => {
    const m = mk.create({ name: "Rapid Transitions" });
    mk.start(m.id);

    // Rapid pause/resume
    for (let i = 0; i < 10; i++) {
      mk.pause(m.id);
      mk.resume(m.id);
    }

    expect(mk.get(m.id)!.state).toBe("executing");
  });
});

describe("Mission Kernel — Edge Cases", () => {
  test("start already-running mission is no-op with success", () => {
    const m = mk.create({ name: "Double Start" });
    mk.start(m.id);

    const secondStart = mk.start(m.id);
    expect(secondStart.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");
  });

  test("pause non-executing mission fails gracefully", () => {
    const m = mk.create({ name: "Pause Created" });
    const result = mk.pause(m.id);
    expect(result.success).toBe(false);
  });

  test("get non-existent mission returns undefined", () => {
    expect(mk.get("nonexistent")).toBeUndefined();
  });

  test("transition non-existent mission fails", () => {
    const result = mk.transition("nonexistent", "executing");
    expect(result.success).toBe(false);
  });
});
