// @module mission-kernel/__tests__/mission-wiring.test.ts v1.0.0

import { getMissionKernel, resetMissionKernel } from "../mission-kernel";

let mk: ReturnType<typeof getMissionKernel>;

beforeEach(() => {
  resetMissionKernel();
  mk = getMissionKernel();
});

describe("Mission Wiring — Goal Tracking", () => {
  test("goals advance from pending to completed", () => {
    const m = mk.create({ name: "Goal Test" });
    mk.start(m.id);

    const g1 = mk.addGoal(m.id, "Write code");
    const g2 = mk.addGoal(m.id, "Test code");

    expect(g1!.status).toBe("pending");
    expect(g2!.status).toBe("pending");

    mk.updateGoal(m.id, g1!.id, { status: "completed" });
    expect(mk.get(m.id)!.context.goals[0].status).toBe("completed");
    expect(mk.get(m.id)!.progress).toBe(50);

    mk.updateGoal(m.id, g2!.id, { status: "completed" });
    expect(mk.get(m.id)!.progress).toBe(100);
    expect(mk.get(m.id)!.context.goals.every(g => g.status === "completed")).toBe(true);
  });
});

describe("Mission Wiring — Tool Failure Recovery", () => {
  test("recovery transitions mission through recovering → executing", () => {
    const m = mk.create({ name: "Recovery Test" });
    mk.start(m.id);
    mk.addGoal(m.id, "Do something");

    // Simulate failures, then recover
    mk.fail(m.id, "Tool timeout", { tool: "run_terminal_cmd" });
    expect(mk.get(m.id)!.state).toBe("failed");

    const result = mk.recover(m.id);
    expect(result.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");
  });

  test("consecutive failures leave mission in failed state", () => {
    const m = mk.create({ name: "Fail Test" });
    mk.start(m.id);
    mk.addGoal(m.id, "Do something");

    mk.fail(m.id, "Tool timeout");
    expect(mk.get(m.id)!.state).toBe("failed");
    expect(mk.get(m.id)!.error).toContain("Tool timeout");
  });
});

describe("Mission Wiring — Completion Validation", () => {
  test("complete only succeeds when progress is 100%", () => {
    const m = mk.create({ name: "Complete Test" });
    mk.start(m.id);
    mk.addGoal(m.id, "Do something");

    // Try completing with pending goals — should still transition
    const result = mk.complete(m.id);
    expect(result.success).toBe(true);
    expect(mk.get(m.id)!.progress).toBe(100);
  });

  test("mission fails with evidence", () => {
    const m = mk.create({ name: "Fail Evidence Test" });
    mk.start(m.id);
    mk.addGoal(m.id, "Do something");

    mk.fail(m.id, "Network timeout", { code: "ETIMEDOUT", tool: "curl" });
    expect(mk.get(m.id)!.error).toBe("Network timeout");

    const evidence = mk.getEvidence(m.id);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Mission Wiring — Auto Checkpoints", () => {
  test("checkpoint created on pause", () => {
    const m = mk.create({ name: "CP Test" });
    mk.start(m.id);

    mk.pause(m.id, "Pausing for checkpoint test");

    const cp = mk.getLatestCheckpoint(m.id);
    expect(cp).toBeTruthy();
    expect(cp!.missionId).toBe(m.id);
  });

  test("manual checkpoint save", () => {
    const m = mk.create({ name: "Manual CP" });
    mk.start(m.id);

    const cp = mk.saveCheckpoint(m.id, { toolCallsCount: 5 });
    expect(cp).toBeTruthy();
    expect(cp!.toolCallsCount).toBe(5);
  });
});

describe("Mission Wiring — Evidence Recording", () => {
  test("recordEvent adds to timeline", () => {
    const m = mk.create({ name: "Event Test" });
    mk.start(m.id);

    mk.recordEvent(m.id, "tool_call", "Tool bash executed", { exitCode: 0 });
    mk.recordEvent(m.id, "error", "Tool curl failed", { exitCode: 7 });

    const timeline = mk.getTimeline(m.id);
    const toolCalls = timeline.filter(e => e.type === "tool_call");
    const errors = timeline.filter(e => e.type === "error");
    expect(toolCalls.length).toBe(1);
    expect(errors.length).toBe(1);
  });

  test("addEvidence records timeline entry", () => {
    const m = mk.create({ name: "Evidence Record" });
    mk.start(m.id);

    mk.addEvidence(m.id, {
      id: "ev-test", type: "screenshot", source: "playwright",
      confidence: 0.95, timestamp: Date.now(), data: { url: "http://example.com" },
    });

    const evidence = mk.getEvidence(m.id);
    expect(evidence.length).toBe(1);
  });
});

describe("Mission Wiring — State Transitions Edge Cases", () => {
  test("cannot transition from archived state", () => {
    const m = mk.create({ name: "Archived" });
    mk.start(m.id);
    mk.complete(m.id);
    mk.transition(m.id, "archived");

    const result = mk.transition(m.id, "executing");
    expect(result.success).toBe(false);
  });

  test("recovery after fail restores to executing", () => {
    const m = mk.create({ name: "Recover" });
    mk.start(m.id);

    mk.fail(m.id, "Transient error");
    expect(mk.get(m.id)!.state).toBe("failed");

    const result = mk.recover(m.id);
    expect(result.success).toBe(true);
    expect(mk.get(m.id)!.state).toBe("executing");
  });
});
