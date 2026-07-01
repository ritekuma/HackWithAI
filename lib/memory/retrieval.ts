// ── Retrieval Engine ──
// Searches all memory sources before task execution for optimal context.

import type { RetrievalContext, ExperienceRecord, KnowledgeEntity } from "./types";
import type { OrchestrationTask } from "@/lib/orchestration/types";
import { RedisMemoryAdapter } from "./redis-adapter";
import { ExperienceEngine } from "./experience";

export class RetrievalEngine {
  constructor(
    private redis: RedisMemoryAdapter,
    private experience: ExperienceEngine,
  ) {}

  /** Gather comprehensive context before executing a task */
  async gather(task: OrchestrationTask): Promise<RetrievalContext> {
    const [experiences, sessionState, knowledge] = await Promise.all([
      this.searchExperiences(task),
      this.getSessionState(),
      this.getKnowledgeEntities(),
    ]);

    return {
      relevantMemories: [],
      experiences,
      knowledge,
      sessionState,
      conversationSummary: await this.summarizeConversation(),
    };
  }

  private async searchExperiences(task: OrchestrationTask): Promise<ExperienceRecord[]> {
    const results: ExperienceRecord[] = [];
    for (const step of task.steps) {
      const similar = this.experience.findSimilar(task.description, step.agentId, 3);
      results.push(...similar);
    }
    // Deduplicate
    return results.filter((r, i, arr) => arr.findIndex((x) => x.problem === r.problem && x.agentId === r.agentId) === i);
  }

  private async getSessionState(): Promise<Record<string, unknown>> {
    const state: Record<string, unknown> = {};
    try {
      const keys = await this.redis.list("session:*");
      for (const key of keys.slice(0, 10)) {
        const entry = await this.redis.get(key);
        if (entry) state[key] = entry;
      }
    } catch {}
    return state;
  }

  private async getKnowledgeEntities(): Promise<KnowledgeEntity[]> {
    // Static knowledge graph built from existing project structure
    return [
      { id: "k-hwai", type: "project", name: "HackWithAI v2", properties: { language: "TypeScript+Python", desktop: true } },
      { id: "k-openrouter", type: "provider", name: "OpenRouter", properties: { models: 3, connected: true } },
      { id: "k-redis", type: "tool", name: "Redis", properties: { port: 6379, status: "connected" } },
      { id: "k-centrifugo", type: "tool", name: "Centrifugo", properties: { port: 8000, status: "connected" } },
      { id: "k-desktop-worker", type: "agent", name: "Desktop Worker", properties: { tools: 4, status: "connected" } },
      { id: "k-convex", type: "tool", name: "Convex", properties: { url: "fastidious-chicken-466.eu-west-1.convex.cloud" } },
      { id: "k-playwright", type: "tool", name: "Playwright", properties: { status: "configured" } },
      { id: "k-orchestrator", type: "agent", name: "Orchestration Engine", properties: { agents: 10, teams: 8, policies: 4 } },
    ];
  }

  private async summarizeConversation(): Promise<string> {
    const keys = await this.redis.list("conversation:*");
    if (keys.length === 0) return "(no conversation history)";
    return `${keys.length} conversation entries cached`;
  }
}
