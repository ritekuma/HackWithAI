// ── Experience Engine ──
// Automatically stores reusable knowledge after every task completion.

import type { ExperienceRecord, MemoryEntry } from "./types";
import type { OrchestrationTask, TaskStep } from "@/lib/orchestration/types";

export class ExperienceEngine {
  private records: ExperienceRecord[] = [];

  /** Capture a completed task as an experience record */
  capture(task: OrchestrationTask): ExperienceRecord[] {
    const records: ExperienceRecord[] = [];

    for (const step of task.steps) {
      if (step.status === "skipped") continue;

      const record: ExperienceRecord = {
        problem: task.description.slice(0, 500),
        solution: step.output?.slice(0, 1000) || "(no output)",
        reasoning: `Agent ${step.agentId} executed: ${task.description.slice(0, 200)}`,
        toolsUsed: step.toolsUsed,
        filesModified: [],
        executionTime: (step.completedAt || Date.now()) - (step.startedAt || Date.now()),
        success: step.status === "completed",
        cost: 0.01, // estimated base
        agentId: step.agentId,
        taskId: task.id,
        timestamp: Date.now(),
        tags: this.extractTags(task.description, step.agentId),
      };

      records.push(record);
    }

    this.records.push(...records);
    return records;
  }

  /** Find similar past experiences */
  findSimilar(description: string, agentId?: string, limit = 5): ExperienceRecord[] {
    const query = description.toLowerCase();
    return this.records
      .filter((r) => !agentId || r.agentId === agentId)
      .filter((r) => r.success)
      .sort((a, b) => {
        const scoreA = this.relevanceScore(query, a.problem + " " + a.solution);
        const scoreB = this.relevanceScore(query, b.problem + " " + b.solution);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /** Get all experiences for metrics */
  getAll(): ExperienceRecord[] {
    return this.records;
  }

  /** Get experience stats */
  getStats() {
    const successes = this.records.filter((r) => r.success);
    return {
      total: this.records.length,
      successRate: this.records.length > 0 ? successes.length / this.records.length : 0,
      averageTime: this.records.length > 0
        ? this.records.reduce((s, r) => s + r.executionTime, 0) / this.records.length
        : 0,
      uniqueAgents: new Set(this.records.map((r) => r.agentId)).size,
      uniqueTools: new Set(this.records.flatMap((r) => r.toolsUsed)).size,
    };
  }

  private extractTags(description: string, agentId: string): string[] {
    const tags = [agentId];
    const keywords: Record<string, string[]> = {
      scan: ["recon", "network"],
      exploit: ["exploitation", "vulnerability"],
      report: ["reporting", "documentation"],
      patch: ["remediation", "fix"],
      deploy: ["deployment"],
      test: ["testing", "validation"],
    };
    for (const [key, values] of Object.entries(keywords)) {
      if (description.toLowerCase().includes(key)) tags.push(...values);
    }
    return [...new Set(tags)];
  }

  private relevanceScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    for (const word of q.split(/\s+/)) {
      if (t.includes(word)) score += 1;
    }
    return score;
  }

  /** Convert experience to a memory entry for storage */
  toMemoryEntry(record: ExperienceRecord): MemoryEntry {
    return {
      id: `exp-${record.taskId}-${record.agentId}`,
      type: "experience",
      content: JSON.stringify(record),
      metadata: { agentId: record.agentId, taskId: record.taskId, success: record.success },
      policy: "permanent",
      createdAt: record.timestamp,
      accessedAt: record.timestamp,
      priority: record.success ? 0.7 : 0.3,
      sourceTaskId: record.taskId,
      sourceAgentId: record.agentId,
      tags: record.tags,
    };
  }
}
