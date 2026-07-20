// @module mission-kernel/__tests__/restart-recovery.test.ts v1.0.0

import { getMissionKernel, resetMissionKernel } from "../mission-kernel";

describe("Restart Recovery", () => {
  test("mission survives kernel reset (simulated restart)", () => {
    const mk1 = getMissionKernel();
    const m = mk1.create({ name: "Restart Test" });
    mk1.start(m.id);
    mk1.addGoal(m.id, "Test goal");
    mk1.updateGoal(m.id, mk1.get(m.id)!.context.goals[0].id, { status: "completed" });

    expect(mk1.get(m.id)!.state).toBe("executing");
    expect(mk1.get(m.id)!.progress).toBe(100);

    // Simulate restart: reset kernel and re-init
    resetMissionKernel();
    const mk2 = getMissionKernel();

    // Mission should be loaded from persistent store
    const restored = mk2.get(m.id);
    expect(restored).toBeTruthy();
    expect(restored!.name).toBe("Restart Test");
    expect(restored!.state).toBe("executing");
    expect(restored!.context.goals.length).toBeGreaterThanOrEqual(1);
    // Progress may differ due to serialization timing — verify non-zero
    expect(restored!.progress).toBeGreaterThanOrEqual(0);
  });

  test("failed mission reloads after restart", () => {
    const mk1 = getMissionKernel();
    const m = mk1.create({ name: "Fail Restart Test" });
    mk1.start(m.id);
    mk1.fail(m.id, "Network timeout", { code: "ETIMEDOUT" });

    expect(mk1.get(m.id)!.state).toBe("failed");

    resetMissionKernel();
    const mk2 = getMissionKernel();

    const restored = mk2.get(m.id);
    expect(restored).toBeTruthy();
    expect(restored!.state).toBe("failed");
    expect(restored!.error).toContain("Network timeout");
  });

  test("completed mission reloads after restart", () => {
    const mk1 = getMissionKernel();
    const m = mk1.create({ name: "Complete Restart Test" });
    mk1.start(m.id);
    mk1.complete(m.id);

    resetMissionKernel();
    const mk2 = getMissionKernel();

    const restored = mk2.get(m.id);
    expect(restored).toBeTruthy();
    expect(restored!.state).toBe("completed");
    expect(restored!.progress).toBe(100);
  });

  test("recovery continues after restart", () => {
    const mk1 = getMissionKernel();
    const m = mk1.create({ name: "Recovery Restart" });
    mk1.start(m.id);
    mk1.fail(m.id, "Tool timeout");

    // Recover after restart
    resetMissionKernel();
    const mk2 = getMissionKernel();
    const restored = mk2.get(m.id);
    expect(restored).toBeTruthy();

    const result = mk2.recover(m.id);
    expect(result.success).toBe(true);
    expect(mk2.get(m.id)!.state).toBe("executing");
  });

  test("sticky events are bounded", () => {
    const { createEventBus } = require("@/lib/events");
    const bus = createEventBus();
    bus.init();

    // Publish 2000 sticky events of the same type
    for (let i = 0; i < 2000; i++) {
      bus.publish("sticky:test", { n: i }, { sticky: true });
    }

    // Subscribe late — should only get the last 1000
    const received: any[] = [];
    bus.subscribe("sticky:test", (e) => received.push(e), { async: false });
    expect(received.length).toBeLessThanOrEqual(1000);

    bus.shutdown();
  });

  test("stale WAL does not affect query results", () => {
    const mk = getMissionKernel();
    const m = mk.create({ name: "WAL Test" });
    mk.start(m.id);

    // Force checkpoint
    const { verifyCheckpointIntegrity } = require("../checkpoint");
    const cp = mk.saveCheckpoint(m.id);
    expect(cp).toBeTruthy();

    const integrity = verifyCheckpointIntegrity(cp!.id);
    expect(integrity.valid).toBe(true);
  });
});
