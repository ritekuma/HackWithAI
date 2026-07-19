// @module events/subscription-engine v1.0.0 — Advanced subscription matching and delivery

import type { Event, EventHandler, Subscription, SubscriptionOptions } from "./types";
import { randomUUID } from "crypto";

const subscriptions = new Map<string, Subscription>();
// Index: pattern -> Set<subscriptionId> for fast wildcard lookup
const patternIndex = new Map<string, Set<string>>();
// Prefix index for faster matching: "mission" -> Set of subscription IDs
const prefixIndex = new Map<string, Set<string>>();
// Group index: groupId -> Set<subscriptionId> for load-balanced delivery
const groupIndex = new Map<string, Set<string>>();

export function addSubscription(
  pattern: string,
  handler: EventHandler,
  options: SubscriptionOptions = {},
): Subscription {
  const id = `sub-${randomUUID()}`;

  const sub: Subscription = {
    id,
    pattern,
    handler,
    options: {
      priority: options.priority ?? 0,
      async: options.async ?? true,
      once: options.once ?? false,
      timeout: options.timeout ?? 30000,
      condition: options.condition,
      filter: options.filter,
      onError: options.onError,
      groupId: options.groupId,
    },
    createdAt: Date.now(),
    active: true,
    deliveredCount: 0,
    failedCount: 0,
  };

  subscriptions.set(id, sub);

  // Index by exact pattern
  if (!patternIndex.has(pattern)) {
    patternIndex.set(pattern, new Set());
  }
  patternIndex.get(pattern)!.add(id);

  // Index by prefix for wildcard matching
  const prefix = getPatternPrefix(pattern);
  if (prefix) {
    if (!prefixIndex.has(prefix)) {
      prefixIndex.set(prefix, new Set());
    }
    prefixIndex.get(prefix)!.add(id);
  }

  // Index by group
  if (options.groupId) {
    if (!groupIndex.has(options.groupId)) {
      groupIndex.set(options.groupId, new Set());
    }
    groupIndex.get(options.groupId)!.add(id);
  }

  return sub;
}

export function removeSubscription(id: string): boolean {
  const sub = subscriptions.get(id);
  if (!sub) return false;

  subscriptions.delete(id);
  patternIndex.get(sub.pattern)?.delete(id);
  const prefix = getPatternPrefix(sub.pattern);
  if (prefix) prefixIndex.get(prefix)?.delete(id);
  if (sub.options.groupId) groupIndex.get(sub.options.groupId)?.delete(id);

  return true;
}

export function getSubscription(id: string): Subscription | undefined {
  return subscriptions.get(id);
}

export function getAllSubscriptions(): Subscription[] {
  return Array.from(subscriptions.values());
}

export function getSubscriptionsForEvent(event: Event): Subscription[] {
  const type = event.type;
  const candidates = new Set<string>();

  // 1. Exact pattern match
  patternIndex.get(type)?.forEach(id => candidates.add(id));

  // 2. Wildcard "type:*" matches
  const prefix = getPatternPrefix(type);
  if (prefix) {
    // Match subscriptions with pattern "prefix:*"
    const wildcardPattern = `${prefix}:*`;
    patternIndex.get(wildcardPattern)?.forEach(id => candidates.add(id));
  }

  // 3. Global wildcard "*" matches
  patternIndex.get("*")?.forEach(id => candidates.add(id));

  // 4. Category prefix wildcard matches
  // e.g., event type "mission:created" matches pattern "mission:*"
  prefixIndex.get(prefix)?.forEach(id => {
    const sub = subscriptions.get(id);
    if (sub && sub.pattern.endsWith("*") && type.startsWith(prefix)) {
      candidates.add(id);
    }
  });

  // 5. Multi-segment wildcard "**" matches
  patternIndex.get("**")?.forEach(id => candidates.add(id));

  // Resolve subscriptions from candidate IDs
  const matched: Subscription[] = [];
  const usedGroups = new Set<string>();

  for (const id of candidates) {
    const sub = subscriptions.get(id);
    if (!sub || !sub.active) continue;

    // Load-balanced group delivery: only one subscriber per group
    if (sub.options.groupId && usedGroups.has(sub.options.groupId)) continue;

    // Conditional subscription
    if (sub.options.condition && !sub.options.condition(event)) continue;

    // Filtered subscription
    if (sub.options.filter && !matchesFilter(event.payload, sub.options.filter)) continue;

    matched.push(sub);

    if (sub.options.groupId) {
      usedGroups.add(sub.options.groupId);
    }
  }

  // Sort by priority (higher first), then creation time (older first)
  matched.sort((a, b) => {
    const priorityDiff = (b.options.priority ?? 0) - (a.options.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });

  return matched;
}

export function matchEventPattern(eventType: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  if (pattern === eventType) return true;
  if (pattern.endsWith(":*") && eventType.startsWith(pattern.slice(0, -2))) return true;
  if (pattern.endsWith(".**")) {
    const prefix = pattern.slice(0, -3);
    return eventType.startsWith(prefix);
  }
  return false;
}

export function getActiveSubscriptionCount(): number {
  return Array.from(subscriptions.values()).filter(s => s.active).length;
}

export function deactivateSubscription(id: string): boolean {
  const sub = subscriptions.get(id);
  if (!sub) return false;
  sub.active = false;
  return true;
}

export function activateSubscription(id: string): boolean {
  const sub = subscriptions.get(id);
  if (!sub) return false;
  sub.active = true;
  return true;
}

export function clearAllSubscriptions(): void {
  subscriptions.clear();
  patternIndex.clear();
  prefixIndex.clear();
  groupIndex.clear();
}

function getPatternPrefix(type: string): string {
  const idx = type.indexOf(":");
  return idx > 0 ? type.substring(0, idx) : type;
}

function matchesFilter(payload: unknown, filter: Record<string, unknown>): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const obj = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (obj[key] !== value) return false;
  }
  return true;
}
