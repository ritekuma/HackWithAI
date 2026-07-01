// ── Memory Registry ──

import type { SessionMemory, ConversationMemory, ProjectMemory, VectorMemory, PersistentMemory, MemoryServiceType, MemoryServiceEntry } from "./types";

export class MemoryRegistry {
  private services = new Map<string, MemoryServiceEntry>();

  registerSession(id: string, service: SessionMemory): void {
    this.services.set(id, { type: "session", id, service, enabled: true });
  }

  registerConversation(id: string, service: ConversationMemory): void {
    this.services.set(id, { type: "conversation", id, service, enabled: true });
  }

  registerProject(id: string, service: ProjectMemory): void {
    this.services.set(id, { type: "project", id, service, enabled: true });
  }

  registerVector(id: string, service: VectorMemory): void {
    this.services.set(id, { type: "vector", id, service, enabled: true });
  }

  registerPersistent(id: string, service: PersistentMemory): void {
    this.services.set(id, { type: "persistent", id, service, enabled: true });
  }

  get(type: MemoryServiceType, id: string): MemoryServiceEntry | undefined {
    const entry = this.services.get(id);
    return entry?.type === type ? entry : undefined;
  }

  getSession(id: string): SessionMemory | undefined {
    return this.get("session", id)?.service as SessionMemory;
  }

  getConversation(id: string): ConversationMemory | undefined {
    return this.get("conversation", id)?.service as ConversationMemory;
  }

  getProject(id: string): ProjectMemory | undefined {
    return this.get("project", id)?.service as ProjectMemory;
  }

  getVector(id: string): VectorMemory | undefined {
    return this.get("vector", id)?.service as VectorMemory;
  }

  getPersistent(id: string): PersistentMemory | undefined {
    return this.get("persistent", id)?.service as PersistentMemory;
  }

  list(): MemoryServiceEntry[] {
    return Array.from(this.services.values());
  }

  listByType(type: MemoryServiceType): MemoryServiceEntry[] {
    return this.list().filter((e) => e.type === type);
  }

  count(): number {
    return this.services.size;
  }
}
