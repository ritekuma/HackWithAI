// @module events/types v1.0.0 — Enterprise Event Bus type system

export type EventPriority = "critical" | "high" | "medium" | "low" | "background";

export type EventStatus = "pending" | "delivered" | "failed" | "dead" | "replayed";

export type EventCategory =
  | "mission"
  | "tool"
  | "executive"
  | "memory"
  | "workspace"
  | "recovery"
  | "simulation"
  | "system"
  | "audit"
  | "telemetry"
  | "chat"
  | "agent";

export interface EventMetadata {
  timestamp: number;
  correlationId: string;          // Links related events in a chain
  causationId?: string;           // Event that directly caused this one
  missionId?: string;
  workspaceId?: string;
  userId?: string;
  sessionId?: string;
  executiveId?: string;
  departmentId?: string;
  agentId?: string;
  chatId?: string;
  priority: EventPriority;
  retryCount: number;
  maxRetries: number;
  ttl?: number;                   // Time-to-live in ms (after which event is expired)
  tags: string[];
  source: string;                 // Module/function that produced the event
  version: string;                // Event schema version
}

export interface Event<T extends string = string, P = unknown> {
  id: string;
  type: T;
  payload: P;
  metadata: EventMetadata;
}

export interface StoredEvent extends Event {
  status: EventStatus;
  category: EventCategory;
  priority: EventPriority;
  storedAt: number;
  deliveredAt?: number;
  failedAt?: number;
  failureReason?: string;
  subscriberId?: string;
  replayOf?: string;
  replayCount: number;
}

export interface EventContract<T extends string = string, P = unknown> {
  type: T;
  category: EventCategory;
  description: string;
  version: string;
  schema: Record<string, unknown>;  // JSON Schema for payload validation
  persistent: boolean;              // Store in event store?
  replayable: boolean;              // Can be replayed?
  auditable: boolean;               // Part of audit trail?
  critical: boolean;                // DLQ on failure?
}

export type EventHandler<T extends Event = Event> = (event: T) => void | Promise<void>;

export interface SubscriptionOptions {
  priority?: number;               // Higher = earlier execution (0 = default)
  async?: boolean;                  // Run handler async?
  condition?: (event: Event) => boolean;  // Conditional subscription
  filter?: Record<string, unknown>;       // Payload field filters
  once?: boolean;                   // Auto-unsubscribe after first delivery
  timeout?: number;                 // Max handler execution time in ms
  onError?: (error: Error, event: Event) => void;
  groupId?: string;                // Group for load-balanced delivery (only one subscriber per group)
}

export interface Subscription {
  id: string;
  pattern: string;                  // Event type or wildcard pattern ("mission:*", "tool.*", "*")
  handler: EventHandler;
  options: SubscriptionOptions;
  createdAt: number;
  active: boolean;
  deliveredCount: number;
  failedCount: number;
  lastDeliveredAt?: number;
  avgLatencyMs?: number;
}

export interface DeadLetterEntry {
  event: StoredEvent;
  failureReason: string;
  stackTrace?: string;
  subscriberId: string;
  recoveryRecommendation?: string;
  retryAttempts: number;
  maxRetryAttempts: number;
  nextRetryAt?: number;
  acknowledged: boolean;
  resolved: boolean;
}

export interface EventBusMetrics {
  published: number;
  delivered: number;
  dropped: number;
  retried: number;
  recovered: number;
  deadLettered: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  queueDepth: number;
  subscriberAvgTimeMs: number;
  failureRate: number;
  activeSubscriptions: number;
  storedEvents: number;
  deadLetterSize: number;
}

export interface ReplayOptions {
  fromTimestamp?: number;
  toTimestamp?: number;
  eventTypes?: string[];
  categories?: EventCategory[];
  missionId?: string;
  workspaceId?: string;
  correlationId?: string;
  speed?: number;                // Replay speed multiplier (1 = real-time, 0 = instant)
  limit?: number;
  includeFailed?: boolean;
}

export interface PublishOptions {
  priority?: EventPriority;
  correlationId?: string;
  causationId?: string;
  missionId?: string;
  workspaceId?: string;
  userId?: string;
  sessionId?: string;
  executiveId?: string;
  departmentId?: string;
  agentId?: string;
  chatId?: string;
  ttl?: number;
  maxRetries?: number;
  tags?: string[];
  delay?: number;               // Delay delivery by N ms
  sticky?: boolean;             // Redeliver to new subscribers
}
