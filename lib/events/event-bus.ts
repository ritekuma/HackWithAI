// @module events/event-bus v1.0.0 — Enterprise Event Bus

import EventEmitter from "events";
import { randomUUID } from "crypto";
import type {
  Event,
  EventHandler,
  EventPriority,
  PublishOptions,
  Subscription,
  SubscriptionOptions,
  EventBusMetrics,
  ReplayOptions,
  DeadLetterEntry,
} from "./types";
import {
  addSubscription,
  removeSubscription,
  getSubscriptionsForEvent,
  getActiveSubscriptionCount,
  clearAllSubscriptions,
  deactivateSubscription,
  activateSubscription,
  getSubscription,
  getAllSubscriptions,
} from "./subscription-engine";
import {
  persistEvent,
  markDelivered,
  markFailed,
  incrementRetry,
  markRecovered,
  generateEventId,
  generateCorrelationId,
  loadEvents,
  purgeExpiredEvents,
} from "./persistence";
import {
  enqueueDeadLetter,
  getPendingRetries,
  resolveDeadLetter,
  acknowledgeDeadLetter,
  scheduleRetry,
  getAllDeadLetters,
  getDeadLetterCount,
  purgeResolvedDeadLetters,
} from "./dead-letter-queue";
import {
  recordEventPublished,
  recordEventDelivered,
  recordEventDropped,
  recordEventRetried,
  recordEventRecovered,
  updateActiveSubscriberCount,
  getEventBusMetrics,
  resetMetrics,
} from "./observability";
import { replayEvents, createReplayEvent } from "./replay";
import { isEventRegistered, getEventContract } from "./registry";

class EventBus extends EventEmitter {
  private initialized = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private stickyEvents = new Map<string, Event[]>();

  constructor() {
    super();
    this.setMaxListeners(10000);
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Start dead letter retry loop
    this.retryTimer = setInterval(() => this.processDeadLetterRetries(), 5000);

    console.info("[EVENT] bus initialized");
  }

  shutdown(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    clearAllSubscriptions();
    this.removeAllListeners();
    this.initialized = false;
    console.info("[EVENT] bus shutdown");
  }

  // ── PUBLISH ──────────────────────────────────────────────

  publish<T extends string = string, P = unknown>(
    type: T,
    payload: P,
    options: PublishOptions = {},
  ): Event<T, P> {
    const id = generateEventId();
    const priority = options.priority || "medium";
    const correlationId = options.correlationId || generateCorrelationId();

    const event: Event<T, P> = {
      id,
      type,
      payload,
      metadata: {
        timestamp: Date.now(),
        correlationId,
        causationId: options.causationId,
        missionId: options.missionId,
        workspaceId: options.workspaceId,
        userId: options.userId,
        sessionId: options.sessionId,
        executiveId: options.executiveId,
        departmentId: options.departmentId,
        agentId: options.agentId,
        chatId: options.chatId,
        priority,
        retryCount: 0,
        maxRetries: options.maxRetries ?? 3,
        ttl: options.ttl,
        tags: options.tags || [],
        source: "event-bus",
        version: "1.0.0",
      },
    };

    // Validate event registration
    if (!isEventRegistered(type as string)) {
      console.debug(`[EVENT] unregistered type=${type} — publish allowed but warn`);
    }

    // Validate contract if exists
    const contract = getEventContract(type as string);

    // Persist if contract requires it or options specify
    if (contract?.persistent !== false) {
      persistEvent(event as unknown as Event, priority);
    }

    recordEventPublished(event as unknown as Event);

    // Handle sticky events
    if (options.sticky) {
      if (!this.stickyEvents.has(type as string)) {
        this.stickyEvents.set(type as string, []);
      }
      this.stickyEvents.get(type as string)!.push(event as unknown as Event);
    }

    // Handle delayed delivery
    if (options.delay && options.delay > 0) {
      setTimeout(() => this.deliverEvent(event as unknown as Event), options.delay);
    } else {
      this.deliverEvent(event as unknown as Event);
    }

    return event;
  }

  // ── REQUEST/REPLY ────────────────────────────────────────

  async request<T extends string = string, P = unknown, R = unknown>(
    type: T,
    payload: P,
    options: PublishOptions = {},
    timeout = 10000,
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const replyType = `${type}:reply` as const;
      const timer = setTimeout(() => {
        this.off(replyType, handler);
        reject(new Error(`Request timed out after ${timeout}ms: ${type}`));
      }, timeout);

      const handler: EventHandler = (replyEvent) => {
        clearTimeout(timer);
        this.off(replyType, handler);
        resolve(replyEvent.payload as R);
      };

      this.subscribe(replyType, handler, { once: true, priority: 999 });
      this.publish(type, payload, options);
    });
  }

  // ── BROADCAST ─────────────────────────────────────────────

  broadcast<T extends string = string, P = unknown>(
    type: T,
    payload: P,
    options: PublishOptions = {},
  ): Event<T, P> {
    return this.publish(type, payload, { ...options, priority: "high" });
  }

  // ── SUBSCRIBE ─────────────────────────────────────────────

  subscribe<T extends string = string>(
    pattern: string,
    handler: EventHandler<Event<T>>,
    options: SubscriptionOptions = {},
  ): Subscription {
    const sub = addSubscription(pattern, handler as EventHandler, options);
    updateActiveSubscriberCount(getActiveSubscriptionCount());

    // Deliver sticky events to new subscriber
    this.deliverStickyEvents(pattern, sub);

    console.debug(`[EVENT] subscribed id=${sub.id} pattern=${pattern} priority=${options.priority || 0}`);
    return sub;
  }

  unsubscribe(id: string): boolean {
    const result = removeSubscription(id);
    updateActiveSubscriberCount(getActiveSubscriptionCount());
    return result;
  }

  getSubscriptionInfo(id: string): Subscription | undefined {
    return getSubscription(id);
  }

  listSubscriptions(): Subscription[] {
    return getAllSubscriptions();
  }

  deactivateSubscriber(id: string): boolean {
    return deactivateSubscription(id);
  }

  activateSubscriber(id: string): boolean {
    return activateSubscription(id);
  }

  getActiveSubscriberCount(): number {
    return getActiveSubscriptionCount();
  }

  // ── DELIVERY ENGINE ──────────────────────────────────────

  private deliverEvent(event: Event): void {
    const subs = getSubscriptionsForEvent(event);
    if (subs.length === 0) return;

    for (const sub of subs) {
      const startTime = Date.now();

      if (sub.options.async !== false) {
        // Async delivery — schedule via microtask to not block caller
        const scheduleAsync = typeof setImmediate === "function"
          ? setImmediate
          : (fn: () => void) => setTimeout(fn, 0);
        scheduleAsync(() => {
          Promise.resolve(sub.handler(event))
            .then(() => {
              const latency = Date.now() - startTime;
              markDelivered(event.id, sub.id);
              recordEventDelivered(event, sub.id, latency);
              sub.deliveredCount++;
              sub.lastDeliveredAt = Date.now();
              sub.avgLatencyMs = sub.avgLatencyMs
                ? (sub.avgLatencyMs * (sub.deliveredCount - 1) + latency) / sub.deliveredCount
                : latency;
              if (sub.options.once) this.unsubscribe(sub.id);
            })
            .catch((error) => {
              this.handleDeliveryFailureSync(event, sub, error);
            });
        });
      } else {
        // Synchronous delivery — runs immediately in current call stack
        try {
          sub.handler(event);
          const latency = Date.now() - startTime;
          markDelivered(event.id, sub.id);
          recordEventDelivered(event, sub.id, latency);
          sub.deliveredCount++;
          sub.lastDeliveredAt = Date.now();
          sub.avgLatencyMs = sub.avgLatencyMs
            ? (sub.avgLatencyMs * (sub.deliveredCount - 1) + latency) / sub.deliveredCount
            : latency;
          if (sub.options.once) this.unsubscribe(sub.id);
        } catch (error) {
          this.handleDeliveryFailureSync(event, sub, error);
        }
      }
    }
  }

  private handleDeliveryFailureSync(event: Event, sub: Subscription, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorMsg = err.message;

    console.error(`[EVENT] delivery failed type=${event.type} subscriber=${sub.id} error=${errorMsg}`);
    sub.failedCount++;

    if (sub.options.onError) {
      sub.options.onError(err, event);
    }

    const shouldRetry = event.metadata.retryCount < event.metadata.maxRetries;

    if (shouldRetry) {
      incrementRetry(event.id);
      recordEventRetried(event);
      event.metadata.retryCount++;
      const delay = Math.min(1000 * Math.pow(2, event.metadata.retryCount), 30000);
      setTimeout(() => this.deliverEvent(event), delay);
    } else {
      recordEventDropped(event, errorMsg);
      markFailed(event.id, sub.id, errorMsg);
      const contract = getEventContract(event.type);
      if (contract?.critical) {
        enqueueDeadLetter(
          event, sub.id, errorMsg, err.stack,
          `Event type '${event.type}' failed after ${event.metadata.maxRetries} retries. Check subscriber '${sub.id}' handler.`,
        );
      }
    }
  }

  // ── STICKY EVENTS ────────────────────────────────────────

  private deliverStickyEvents(pattern: string, sub: Subscription): void {
    for (const [type, events] of this.stickyEvents) {
      // Only deliver if the subscriber's pattern would match this event type
      const { matchEventPattern } = require("./subscription-engine");
      if (matchEventPattern(type, pattern) || matchEventPattern(type, sub.pattern)) {
        for (const event of events) {
          try {
            sub.handler(event);
          } catch (error) {
            console.warn(`[EVENT] sticky delivery failed type=${type} subscriber=${sub.id}`);
          }
        }
      }
    }
  }

  // ── DEAD LETTER PROCESSING ───────────────────────────────

  private async processDeadLetterRetries(): Promise<void> {
    try {
      const pending = getPendingRetries(10);
      for (const entry of pending) {
        try {
          // Re-publish the event
          const replayedEvent = createReplayEvent(entry.event);
          this.publish(entry.event.type as any, replayedEvent.payload, {
            correlationId: entry.event.metadata.correlationId,
            priority: entry.event.metadata.priority,
          });
          resolveDeadLetter(entry.event.id);
          console.info(`[EVENT] dlq resolved event=${entry.event.id} type=${entry.event.type}`);
        } catch {
          scheduleRetry(entry.event.id, entry.retryAttempts + 1);
        }
      }
    } catch (error) {
      // Silently continue — DLQ processing is best-effort
    }
  }

  // ── REPLAY ───────────────────────────────────────────────

  async replay(options: ReplayOptions): Promise<{ replayed: number; failed: number; errors: Error[] }> {
    return replayEvents(options, async (event) => {
      this.deliverEvent(event);
    });
  }

  async replayMission(missionId: string): Promise<number> {
    const result = await this.replay({ missionId, speed: 0 });
    return result.replayed;
  }

  async replayWorkspace(workspaceId: string): Promise<number> {
    const result = await this.replay({ workspaceId, speed: 0 });
    return result.replayed;
  }

  // ── METRICS ──────────────────────────────────────────────

  getMetrics(): EventBusMetrics {
    return getEventBusMetrics();
  }

  resetMetrics(): void {
    resetMetrics();
  }

  // ── DEAD LETTER QUEUE ACCESS ─────────────────────────────

  getDeadLetters(limit = 100): DeadLetterEntry[] {
    return getAllDeadLetters(limit);
  }

  getDeadLetterCount(): number {
    return getDeadLetterCount();
  }

  acknowledgeDeadLetter(id: string): void {
    acknowledgeDeadLetter(id);
  }

  resolveDeadLetter(id: string): void {
    resolveDeadLetter(id);
  }

  purgeDeadLetters(olderThanDays = 7): number {
    return purgeResolvedDeadLetters(olderThanDays);
  }

  // ── QUERY ────────────────────────────────────────────────

  queryEvents(filter: {
    types?: string[];
    categories?: string[];
    missionId?: string;
    workspaceId?: string;
    correlationId?: string;
    chatId?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
  }): Event[] {
    return loadEvents(filter);
  }

  // ── MAINTENANCE ──────────────────────────────────────────

  purgeExpired(): number {
    return purgeExpiredEvents();
  }

  getStatus(): {
    initialized: boolean;
    subscriptions: number;
    storedEvents: number;
    deadLetters: number;
    uptime: number;
  } {
    const metrics = getEventBusMetrics();
    return {
      initialized: this.initialized,
      subscriptions: getActiveSubscriptionCount(),
      storedEvents: metrics.storedEvents,
      deadLetters: metrics.deadLetterSize,
      uptime: process.uptime() * 1000,
    };
  }
}

// ── SINGLETON ────────────────────────────────────────────

let busInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!busInstance) {
    busInstance = new EventBus();
    busInstance.init();
  }
  return busInstance;
}

export function createEventBus(): EventBus {
  return new EventBus();
}
