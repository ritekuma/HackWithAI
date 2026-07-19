// @module events/replay v1.0.0 — Event replay engine

import { loadEvents, generateEventId, generateCorrelationId } from "./persistence";
import type { StoredEvent, ReplayOptions, Event, PublishOptions } from "./types";

export async function replayEvents(
  options: ReplayOptions,
  publishFn: (event: Event, opts?: PublishOptions) => Promise<void>,
): Promise<{ replayed: number; failed: number; errors: Error[] }> {
  const events = loadEvents({
    types: options.eventTypes,
    categories: options.categories,
    missionId: options.missionId,
    workspaceId: options.workspaceId,
    correlationId: options.correlationId,
    fromTimestamp: options.fromTimestamp,
    toTimestamp: options.toTimestamp,
    limit: options.limit,
  });

  if (events.length === 0) {
    return { replayed: 0, failed: 0, errors: [] };
  }

  const speed = options.speed ?? 0; // 0 = instant
  const errors: Error[] = [];
  let replayed = 0;
  let failed = 0;
  let lastTimestamp = events[0].metadata.timestamp;

  for (const storedEvent of events) {
    // Calculate delay between events for real-time replay
    if (speed > 0) {
      const gap = storedEvent.metadata.timestamp - lastTimestamp;
      if (gap > 0) {
        await sleep(gap / speed);
      }
    } else if (speed < 0) {
      // Batch: small delay between batches
      await sleep(1);
    }

    try {
      const replayedEvent = createReplayEvent(storedEvent);
      await publishFn(replayedEvent, {
        correlationId: options.correlationId || storedEvent.metadata.correlationId,
        causationId: storedEvent.id,
        missionId: storedEvent.metadata.missionId,
        workspaceId: storedEvent.metadata.workspaceId,
        priority: storedEvent.metadata.priority,
      });
      replayed++;
    } catch (error) {
      failed++;
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }

    lastTimestamp = storedEvent.metadata.timestamp;
  }

  return { replayed, failed, errors };
}

export async function replayMissionEvents(
  missionId: string,
  publishFn: (event: Event) => Promise<void>,
): Promise<number> {
  const result = await replayEvents({ missionId, speed: 0 }, publishFn as (e: Event, o?: PublishOptions) => Promise<void>);
  return result.replayed;
}

export async function replayWorkspaceEvents(
  workspaceId: string,
  publishFn: (event: Event) => Promise<void>,
): Promise<number> {
  const result = await replayEvents({ workspaceId, speed: 0 }, publishFn as (e: Event, o?: PublishOptions) => Promise<void>);
  return result.replayed;
}

export async function replayRecoveryEvents(
  correlationId: string,
  publishFn: (event: Event) => Promise<void>,
): Promise<number> {
  const result = await replayEvents(
    { categories: ["recovery"], fromTimestamp: Date.now() - 3600000 },
    publishFn as (e: Event, o?: PublishOptions) => Promise<void>,
  );
  return result.replayed;
}

export function createReplayEvent(storedEvent: StoredEvent): Event {
  return {
    id: storedEvent.id,
    type: storedEvent.type,
    payload: storedEvent.payload,
    metadata: {
      ...storedEvent.metadata,
      timestamp: Date.now(),
      correlationId: storedEvent.metadata.correlationId,
      causationId: storedEvent.metadata.causationId,
      retryCount: 0,
      tags: [...(storedEvent.metadata.tags || []), "replayed"],
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
