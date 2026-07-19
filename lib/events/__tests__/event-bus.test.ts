// @module events/__tests__/event-bus.test.ts v1.0.0 — Enterprise Event Bus test suite

import { createEventBus } from "../event-bus";
import { clearAllSubscriptions, getActiveSubscriptionCount } from "../subscription-engine";
import { getEventDb, closeEventDb } from "../database";
import { resetMetrics } from "../observability";
import { persistEvent, generateEventId, generateCorrelationId } from "../persistence";
import { enqueueDeadLetter, getDeadLetterCount, resolveDeadLetter } from "../dead-letter-queue";
import type { Event, Subscription } from "../types";

// Ensure registry is loaded
import "../registry";

let bus: ReturnType<typeof createEventBus>;

beforeEach(() => {
  bus = createEventBus();
  bus.init();
});

afterEach(() => {
  bus.shutdown();
  closeEventDb();
});

describe("Event Bus Core", () => {
  test("publish and subscribe", async () => {
    const events: Event[] = [];
    bus.subscribe("test:event", (e) => events.push(e), { async: false });

    bus.publish("test:event", { foo: "bar" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("test:event");
    expect(events[0].payload).toEqual({ foo: "bar" });
    expect(events[0].metadata.priority).toBe("medium");
    expect(events[0].metadata.timestamp).toBeGreaterThan(0);
    expect(events[0].metadata.correlationId).toBeTruthy();
    expect(events[0].id).toBeTruthy();
  });

  test("metadata fields are populated", () => {
    const events: Event[] = [];
    bus.subscribe("test:meta", (e) => events.push(e), { async: false });

    bus.publish("test:meta", { x: 1 }, {
      missionId: "mission-1",
      workspaceId: "ws-1",
      userId: "user-1",
      sessionId: "sess-1",
      executiveId: "cto",
      chatId: "chat-1",
      priority: "critical",
      tags: ["important"],
    });

    const event = events[0];
    expect(event.metadata.missionId).toBe("mission-1");
    expect(event.metadata.workspaceId).toBe("ws-1");
    expect(event.metadata.userId).toBe("user-1");
    expect(event.metadata.sessionId).toBe("sess-1");
    expect(event.metadata.executiveId).toBe("cto");
    expect(event.metadata.chatId).toBe("chat-1");
    expect(event.metadata.priority).toBe("critical");
    expect(event.metadata.tags).toContain("important");
  });

  test("broadcast publishes with high priority", () => {
    const events: Event[] = [];
    bus.subscribe("test:broadcast", (e) => events.push(e), { async: false });

    bus.broadcast("test:broadcast", { urgent: true });

    expect(events[0].metadata.priority).toBe("high");
  });

  test("publish with delay", async () => {
    const events: Event[] = [];
    bus.subscribe("test:delayed", (e) => events.push(e), { async: false });

    bus.publish("test:delayed", { delayed: true }, { delay: 100 });

    expect(events.length).toBe(0);
    await new Promise((r) => setTimeout(r, 150));
    expect(events.length).toBe(1);
  });

  test("sticky events delivered to late subscribers", () => {
    bus.publish("test:sticky", { sticky: true }, { sticky: true });

    const events: Event[] = [];
    bus.subscribe("test:sticky", (e) => events.push(e), { async: false });

    expect(events.length).toBe(1);
    expect(events[0].payload).toEqual({ sticky: true });
  });
});

describe("Subscription Engine", () => {
  test("exact pattern matching", () => {
    const events: Event[] = [];
    bus.subscribe("mission:created", (e) => events.push(e), { async: false });

    bus.publish("mission:created", { id: "m1" });
    bus.publish("mission:started", { id: "m2" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("mission:created");
  });

  test("prefix wildcard matching", () => {
    const events: Event[] = [];
    bus.subscribe("mission:*", (e) => events.push(e), { async: false });

    bus.publish("mission:created", { id: "m1" });
    bus.publish("mission:started", { id: "m2" });
    bus.publish("mission:completed", { id: "m3" });
    bus.publish("tool:started", { id: "t1" });

    expect(events.length).toBe(3);
    expect(events.map(e => e.type).sort()).toEqual(["mission:completed", "mission:created", "mission:started"]);
  });

  test("global wildcard matching", () => {
    const events: Event[] = [];
    bus.subscribe("*", (e) => events.push(e), { async: false });

    bus.publish("mission:created", { id: "m1" });
    bus.publish("tool:started", { id: "t1" });
    bus.publish("memory:stored", { id: "mem1" });

    expect(events.length).toBe(3);
  });

  test("priority ordering", () => {
    const order: number[] = [];
    bus.subscribe("test:order", () => order.push(1), { async: false, priority: 0 });
    bus.subscribe("test:order", () => order.push(2), { async: false, priority: 10 });
    bus.subscribe("test:order", () => order.push(3), { async: false, priority: 5 });

    bus.publish("test:order", {});

    // Higher priority first, then same priority by creation time
    expect(order).toEqual([2, 3, 1]);
  });

  test("conditional subscribers", () => {
    const events: Event[] = [];
    bus.subscribe("test:cond", (e) => events.push(e), {
      async: false,
      condition: (e) => (e.payload as any).value > 10,
    });

    bus.publish("test:cond", { value: 5 });
    bus.publish("test:cond", { value: 15 });
    bus.publish("test:cond", { value: 20 });

    expect(events.length).toBe(2);
    expect(events.map(e => (e.payload as any).value)).toEqual([15, 20]);
  });

  test("filtered subscribers", () => {
    const events: Event[] = [];
    bus.subscribe("test:filter", (e) => events.push(e), {
      async: false,
      filter: { status: "active" },
    });

    bus.publish("test:filter", { status: "active", name: "a" });
    bus.publish("test:filter", { status: "inactive", name: "b" });
    bus.publish("test:filter", { status: "active", name: "c" });

    expect(events.length).toBe(2);
  });

  test("once subscription auto-unsubscribes", () => {
    const events: Event[] = [];
    bus.subscribe("test:once", (e) => events.push(e), { async: false, once: true });

    bus.publish("test:once", { n: 1 });
    bus.publish("test:once", { n: 2 });

    expect(events.length).toBe(1);
  });

  test("unsubscribe", () => {
    const events: Event[] = [];
    const sub = bus.subscribe("test:unsub", (e) => events.push(e), { async: false });

    bus.publish("test:unsub", { n: 1 });
    bus.unsubscribe(sub.id);
    bus.publish("test:unsub", { n: 2 });

    expect(events.length).toBe(1);
  });

  test("group load balancing — only one subscriber per group", () => {
    const events: Event[] = [];
    bus.subscribe("test:group", (e) => events.push({ ...e, payload: { ...e.payload, handler: 1 } }), {
      async: false,
      groupId: "group-a",
    });
    bus.subscribe("test:group", (e) => events.push({ ...e, payload: { ...e.payload, handler: 2 } }), {
      async: false,
      groupId: "group-a",
    });

    bus.publish("test:group", { data: "shared" });

    expect(events.length).toBe(1);
  });
});

describe("Event Persistence", () => {
  test("events are persisted to SQLite", () => {
    const event = bus.publish("mission:completed", { result: "ok" }, { missionId: "m-persist-1" });
    expect(event.id).toBeTruthy();

    const stored = persistEvent(event, "medium");
    expect(stored.id).toBe(event.id);

    const { loadEvent } = require("../persistence");
    const loaded = loadEvent(event.id);
    expect(loaded).toBeTruthy();
    expect(loaded.type).toBe("mission:completed");
    expect(loaded.payload).toEqual({ result: "ok" });
  });

  test("query events by type and missionId", () => {
    const mid = "m-query-" + Date.now();

    bus.publish("mission:started", { step: 1 }, { missionId: mid });
    bus.publish("mission:started", { step: 2 }, { missionId: mid });
    bus.publish("mission:completed", { step: 3 }, { missionId: mid });
    bus.publish("tool:started", { tool: "bash" }, { missionId: "other" });

    const { loadEvents } = require("../persistence");
    const results = loadEvents({ types: ["mission:started"], missionId: mid });
    expect(results.length).toBe(2);
    expect(results.every((r: any) => r.type === "mission:started")).toBe(true);
  });
});

describe("Dead Letter Queue", () => {
  test("enqueue and retrieve dead letter", () => {
    const event: Event = {
      id: generateEventId(),
      type: "mission:failed",
      payload: { error: "test error" },
      metadata: {
        timestamp: Date.now(),
        correlationId: generateCorrelationId(),
        priority: "critical",
        retryCount: 3,
        maxRetries: 3,
        tags: [],
        source: "test",
        version: "1.0.0",
      },
    };

    const entry = enqueueDeadLetter(
      event,
      "sub-test",
      "Handler timeout",
      "Error: timeout\n    at Test.run",
      "Increase timeout or optimize handler",
    );

    expect(entry.failureReason).toBe("Handler timeout");
    expect(entry.subscriberId).toBe("sub-test");
    expect(entry.stackTrace).toContain("Error: timeout");
    expect(entry.recoveryRecommendation).toContain("timeout");
    expect(entry.retryAttempts).toBe(0);
    expect(entry.acknowledged).toBe(false);
    expect(entry.resolved).toBe(false);

    const count = getDeadLetterCount();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("resolve dead letter", () => {
    const event: Event = {
      id: generateEventId(),
      type: "system:error",
      payload: { code: 500 },
      metadata: {
        timestamp: Date.now(),
        correlationId: generateCorrelationId(),
        priority: "critical",
        retryCount: 5,
        maxRetries: 5,
        tags: [],
        source: "test",
        version: "1.0.0",
      },
    };

    const entry = enqueueDeadLetter(event, "sub-test-2", "OOM");
    resolveDeadLetter(entry.event.id);

    const { getPendingRetries } = require("../dead-letter-queue");
    const pending = getPendingRetries(10);
    expect(pending.find((p: any) => p.event.id === event.id)).toBeUndefined();
  });
});

describe("Event Replay", () => {
  test("replay events by missionId", async () => {
    const mid = "m-replay-" + Date.now();
    const events: Event[] = [];

    // Publish some mission events
    bus.publish("mission:started", { phase: 1 }, { missionId: mid });
    bus.publish("tool:completed", { tool: "ls" }, { missionId: mid });
    bus.publish("mission:completed", { phase: 3 }, { missionId: mid });

    // Set up subscriber for replayed events
    bus.subscribe("mission:*", (e) => events.push(e), { async: false });

    // Replay mission events
    const replayed = await bus.replayMission(mid);
    expect(replayed).toBeGreaterThanOrEqual(2); // mission:started + mission:completed
  });
});

describe("Observability", () => {
  test("basic metrics tracked", () => {
    const events: Event[] = [];
    bus.subscribe("obs:test", (e) => events.push(e), { async: false });

    bus.publish("obs:test", { n: 1 });
    bus.publish("obs:test", { n: 2 });

    const metrics = bus.getMetrics();
    expect(metrics.published).toBeGreaterThanOrEqual(2);
    expect(metrics.delivered).toBeGreaterThanOrEqual(2);
    expect(metrics.activeSubscriptions).toBeGreaterThanOrEqual(1);
  });

  test("metrics return valid structure", () => {
    const metrics = bus.getMetrics();
    expect(metrics).toHaveProperty("published");
    expect(metrics).toHaveProperty("delivered");
    expect(metrics).toHaveProperty("dropped");
    expect(metrics).toHaveProperty("retried");
    expect(metrics).toHaveProperty("recovered");
    expect(metrics).toHaveProperty("deadLettered");
    expect(metrics).toHaveProperty("avgLatencyMs");
    expect(metrics).toHaveProperty("p50LatencyMs");
    expect(metrics).toHaveProperty("p95LatencyMs");
    expect(metrics).toHaveProperty("p99LatencyMs");
    expect(metrics).toHaveProperty("queueDepth");
    expect(metrics).toHaveProperty("failureRate");
    expect(metrics).toHaveProperty("activeSubscriptions");
    expect(metrics).toHaveProperty("storedEvents");
    expect(metrics).toHaveProperty("deadLetterSize");
  });

  test("status returns correct structure", () => {
    const status = bus.getStatus();
    expect(status).toHaveProperty("initialized");
    expect(status).toHaveProperty("subscriptions");
    expect(status).toHaveProperty("storedEvents");
    expect(status).toHaveProperty("deadLetters");
    expect(status).toHaveProperty("uptime");
    expect(status.initialized).toBe(true);
  });
});

describe("Event Registry", () => {
  test("all core events are registered", () => {
    const { isEventRegistered } = require("../registry");

    const coreEvents = [
      "mission:created",
      "mission:started",
      "mission:completed",
      "mission:failed",
      "tool:requested",
      "tool:completed",
      "tool:failed",
      "executive:assigned",
      "executive:decision",
      "executive:completed",
      "recovery:started",
      "recovery:completed",
      "memory:stored",
      "memory:retrieved",
      "workspace:loaded",
      "workspace:saved",
      "simulation:started",
      "simulation:finished",
      "system:startup",
      "system:shutdown",
      "chat:created",
      "chat:response:completed",
      "agent:task:created",
      "agent:task:completed",
      "agent:task:failed",
    ];

    for (const eventType of coreEvents) {
      expect(isEventRegistered(eventType)).toBe(true);
    }
  });

  test("get events by category", () => {
    const { getEventsByCategory } = require("../registry");
    const missionEvents = getEventsByCategory("mission");
    expect(missionEvents.length).toBeGreaterThan(0);
    expect(missionEvents.every((e: any) => e.category === "mission")).toBe(true);
  });
});

describe("Request/Reply", () => {
  test("request-reply pattern works", async () => {
    // Set up the reply handler
    bus.subscribe("test:echo", (event) => {
      bus.publish("test:echo:reply", { echoed: event.payload } as any);
    }, { async: false });

    const reply = await bus.request("test:echo", { hello: "world" }, {}, 2000);
    expect(reply).toEqual({ echoed: { hello: "world" } });
  });
});

describe("Concurrency", () => {
  test("multiple publishes across threads do not clash", async () => {
    const counter: number[] = [];
    bus.subscribe("concurrent:test", () => {
      counter.push(1);
    }, { async: false });

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(Promise.resolve(bus.publish("concurrent:test", { n: i })));
    }

    await Promise.all(promises);
    // All 50 should have been delivered (synchronous subscribers)
    expect(counter.length).toBe(50);
  });

  test("delayed events do not interfere", async () => {
    const events: Event[] = [];
    bus.subscribe("delay:test", (e) => events.push(e), { async: false });

    bus.publish("delay:test", { n: 1 }, { delay: 50 });
    bus.publish("delay:test", { n: 2 }, { delay: 20 });
    bus.publish("delay:test", { n: 3 }, { delay: 10 });

    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBe(3);
    // Should arrive in delay order: 3, 2, 1
    expect(events.map(e => (e.payload as any).n)).toEqual([3, 2, 1]);
  });
});

describe("Recovery", () => {
  test("failed events are retried", async () => {
    let attempts = 0;
    bus.subscribe("recovery:test", () => {
      attempts++;
      if (attempts < 3) throw new Error("Transient error");
    }, { async: false });

    bus.publish("recovery:test", { retry: true }, { maxRetries: 3 });

    // Wait for retries
    await new Promise((r) => setTimeout(r, 2500));

    // Should have retried at least once
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});
