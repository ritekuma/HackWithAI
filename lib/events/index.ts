// @module events v1.0.0 — Enterprise Event Bus public API

export { getEventBus, createEventBus } from "./event-bus";
export type {
  Event,
  EventHandler,
  EventPriority,
  EventStatus,
  EventCategory,
  EventMetadata,
  EventContract,
  StoredEvent,
  Subscription,
  SubscriptionOptions,
  PublishOptions,
  ReplayOptions,
  DeadLetterEntry,
  EventBusMetrics,
} from "./types";
export {
  registerEvent,
  getEventContract,
  getAllEventContracts,
  getEventsByCategory,
  isEventRegistered,
} from "./registry";
export {
  persistEvent,
  loadEvent,
  loadEvents,
  generateEventId,
  generateCorrelationId,
} from "./persistence";
export {
  enqueueDeadLetter,
  loadDeadLetterEntry,
  getPendingRetries,
  getAllDeadLetters,
  getDeadLetterCount,
  acknowledgeDeadLetter,
  resolveDeadLetter,
  purgeResolvedDeadLetters,
} from "./dead-letter-queue";
export {
  getEventBusMetrics,
  resetMetrics,
} from "./observability";
export {
  replayEvents,
  replayMissionEvents,
  replayWorkspaceEvents,
  replayRecoveryEvents,
} from "./replay";

// Auto-import the registry to register all events
import "./registry";
