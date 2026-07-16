// ── Continuous Learning & Experience Memory ──
// System improves after every verified mission. Confidence-based.

import fs from "fs";
import path from "path";
import type { ToolResponse } from "@/lib/tools/executor";

// ── Types ─────────────────────────────────────────────────────────────
export type Confidence = 25 | 50 | 75 | 100;
export type ExperienceType = "verified_success" | "verified_failure" | "repair_pattern" | "workflow_pattern" | "repository_pattern";

export interface Experience {
  id: string;
  type: ExperienceType;
  problem: string;
  rootCause: string;
  repair: string;
  verification: string;
  successRate: number;
  avgRepairMs: number;
  agentUsed: string;
  workflowUsed: string;
  repository: string;
  techStack: string[];
  confidence: Confidence;
  createdAt: number;
  verifiedAt: number | null;
  reuseCount: number;
}

export interface PatternMatch {
  experience: Experience;
  score: number;
}

// ── Storage ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_PATH = path.join(DATA_DIR, "experience_memory.json");

// ── Pattern Library ───────────────────────────────────────────────────
class PatternLibrary {
  private patterns: Experience[] = [];

  constructor() { this.load(); }

  private load() {
    try { if (fs.existsSync(MEMORY_PATH)) this.patterns = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf-8")); }
    catch { this.patterns = []; }
  }
  private save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.patterns, null, 2));
  }

  add(exp: Experience): Experience {
    exp.id = `exp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    exp.createdAt = Date.now();
    this.patterns.push(exp);
    this.save();
    return exp;
  }

  search(problem: string, limit = 5): PatternMatch[] {
    const p = problem.toLowerCase();
    return this.patterns
      .filter(e => e.confidence >= 75) // Only high-confidence matches
      .map(e => {
        const score = [e.problem, e.rootCause, e.repair, ...e.techStack]
          .reduce((s, t) => s + (t.toLowerCase().includes(p) ? 1 : 0) + (p.includes(t.toLowerCase()) ? 1 : 0), 0);
        return { experience: e, score };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getByAgent(agent: string): Experience[] {
    return this.patterns.filter(e => e.agentUsed === agent);
  }

  getByRepo(repo: string): Experience[] {
    return this.patterns.filter(e => e.repository === repo);
  }

  getStats() {
    const verified = this.patterns.filter(e => e.confidence >= 100).length;
    const candidate = this.patterns.filter(e => e.confidence >= 50 && e.confidence < 100).length;
    const experimental = this.patterns.filter(e => e.confidence < 50).length;
    const repairs = this.patterns.filter(e => e.type === "repair_pattern");
    const topRepair = repairs.sort((a, b) => b.reuseCount - a.reuseCount).slice(0, 5);
    return { total: this.patterns.length, verified, candidate, experimental, topRepair: topRepair.map(r => ({ problem: r.problem.substring(0, 60), repair: r.repair.substring(0, 60), reused: r.reuseCount })) };
  }
}

// ── Experience Scorer ─────────────────────────────────────────────────
class ExperienceScorer {
  score(exp: Experience, successCount: number, totalAttempts: number, avgDurationMs: number): Confidence {
    const rate = totalAttempts > 0 ? successCount / totalAttempts : 0;
    if (rate >= 0.9 && exp.reuseCount >= 3) return 100;  // Verified
    if (rate >= 0.7) return 75;  // Likely
    if (rate >= 0.4) return 50;  // Candidate
    return 25;  // Experimental
  }
}

// ── Learning Engine ───────────────────────────────────────────────────
export class LearningEngine {
  readonly patterns = new PatternLibrary();
  readonly scorer = new ExperienceScorer();

  /** Learn from a mission result */
  learn(result: {
    problem: string; rootCause: string; repair: string; verification: string;
    agent: string; workflow: string; repository: string; techStack: string[];
    success: boolean; attempts: number; durationMs: number;
  }): Experience | null {
    // Only learn from tool-verified outcomes, never model text
    if (!result.rootCause || result.rootCause.length < 3) return null;

    const exp: Experience = {
      id: "", type: result.success ? "verified_success" : "verified_failure",
      problem: result.problem.substring(0, 200),
      rootCause: result.rootCause.substring(0, 200),
      repair: result.repair.substring(0, 200),
      verification: result.verification.substring(0, 100),
      successRate: result.success ? 1.0 : 0.0,
      avgRepairMs: result.durationMs,
      agentUsed: result.agent,
      workflowUsed: result.workflow,
      repository: result.repository || process.cwd(),
      techStack: result.techStack || [],
      confidence: result.success ? 75 : 25, // Start as Likely or Experimental
      createdAt: 0,
      verifiedAt: result.success ? Date.now() : null,
      reuseCount: 0,
    };

    return this.patterns.add(exp);
  }

  /** Find the best existing repair for a problem */
  findRepair(problem: string, agent: string): Experience | null {
    const matches = this.patterns.search(problem, 3);
    if (matches.length === 0) return null;

    const best = matches[0].experience;
    best.reuseCount++;
    this.patterns.add({ ...best, id: best.id }); // update in place
    console.info(`[learning] reused repair for "${problem.substring(0, 50)}" (confidence=${best.confidence}, reused=${best.reuseCount})`);
    return best;
  }

  /** Promote an experience after successful reuse */
  promote(existing: Experience, success: boolean): Confidence {
    if (!existing) return 25;
    const confidence = this.scorer.score(existing, success ? 1 : 0, 1, 0);
    existing.confidence = Math.max(existing.confidence, confidence) as Confidence;
    if (confidence >= 100) existing.verifiedAt = Date.now();
    return existing.confidence;
  }

  /** Record a failure pattern for future learning */
  recordFailure(failure: ToolResponse, category: string, agent: string): void {
    if (!failure.stderr && !failure.stdout) return;
    this.patterns.add({
      id: "", type: "verified_failure",
      problem: `${category}: ${failure.stderr?.substring(0, 80) || failure.stdout?.substring(0, 80)}`,
      rootCause: category,
      repair: "",
      verification: "",
      successRate: 0,
      avgRepairMs: failure.durationMs,
      agentUsed: agent, workflowUsed: "auto", repository: process.cwd(),
      techStack: [],
      confidence: 25, createdAt: Date.now(), verifiedAt: null, reuseCount: 0,
    });
  }

  getStats() { return this.patterns.getStats(); }
}

// ── Singleton ─────────────────────────────────────────────────────────
let _learner: LearningEngine | null = null;
export function getLearningEngine(): LearningEngine {
  if (!_learner) _learner = new LearningEngine();
  return _learner;
}
