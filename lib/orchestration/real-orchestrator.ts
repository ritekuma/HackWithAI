// ── Real Multi-Agent Orchestration Engine ──
// Replaces every simulated agent with real LLM-driven execution.
// Uses the existing AI SDK provider infrastructure (OpenRouter).

import { generateText, tool, type ToolSet } from "ai";
import { myProvider } from "@/lib/ai/providers";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Mission Controller Integration ──
import { MissionController, GoalValidator, MissionCritic } from "@/lib/mission/core";
import type { CriticAction, ProgressScore } from "@/lib/mission/core";

// ── Agent Definition ─────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  modelKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentResult {
  agent: string;
  role: string;
  output: string;
  tokens: { input: number; output: number; total: number };
  durationMs: number;
  toolCalls: number;
  error?: string;
}

export interface TaskStep {
  id: string;
  description: string;
  agent: string;
  dependsOn: string[];
  context?: string;
}

export interface OrchestrationResult {
  steps: TaskStep[];
  results: AgentResult[];
  executionGraph: Record<string, string[]>;
  totalDurationMs: number;
  totalTokens: { input: number; output: number; total: number };
  consensus: string;
  failureCount: number;
}

// ── Shared Tools ──────────────────────────────────────────────────────

const sharedTools = {
  read_file: tool({
    description: "Read file contents from the local filesystem.",
    parameters: z.object({
      path: z.string().describe("Absolute file path"),
      maxBytes: z.number().optional().default(10240),
    }),
    execute: async (args: any) => {
      try {
        const content = fs.readFileSync(args.path, "utf-8");
        const max = args.maxBytes || 10240;
        return { content: content.substring(0, max), truncated: content.length > max };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  }),
  write_file: tool({
    description: "Write content to a file.",
    parameters: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async (args: any) => {
      try {
        const dir = path.dirname(args.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.path, args.content, "utf-8");
        return { success: true, path: args.path, bytes: Buffer.byteLength(args.content) };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  }),
  run_command: tool({
    description: "Execute a shell command.",
    parameters: z.object({
      command: z.string(),
      timeout: z.number().optional().default(30000),
    }),
    execute: async (args: any) => {
      try {
        const output = execSync(args.command, {
          timeout: args.timeout || 30000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          shell: "/bin/bash",
        });
        return { stdout: output, exitCode: 0 };
      } catch (e: any) {
        const stdout = e.stdout?.toString() || "";
        const stderr = e.stderr?.toString() || "";
        const exitCode = e.status != null ? e.status : (e.signal ? 128 + (e.signal === "SIGTERM" ? 15 : 1) : 1);
        return { stdout, stderr: stderr || `exit code ${exitCode}`, exitCode, command: args.command };
      }
    },
  }),
};

// ── Agent Configurations ──────────────────────────────────────────────

const AGENTS: Record<string, AgentConfig> = {
  planner: {
    name: "Planner",
    role: "planning",
    systemPrompt: `You are the Planner agent. Produce an execution DAG with REAL parallel groups.

Output ONLY a JSON array of steps. Each step:
- "id": unique string
- "agent": one of [researcher, architect, coder, tester, security, reviewer, critic]
- "description": what this step does
- "dependsOn": array of step IDs this depends on (empty = no deps)

REQUIRED PARALLEL STRUCTURE:
- researcher and architect MUST each depend ONLY on the planner step. Nothing else. They run IN PARALLEL.
- coder depends on BOTH researcher AND architect. Waits for both.
- tester, reviewer, security, AND critic each depend ONLY on coder. All 4 run IN PARALLEL after coder.

Example correct output for a coding task:
[
  {"id":"s1","agent":"researcher","description":"Research requirements","dependsOn":[]},
  {"id":"s2","agent":"architect","description":"Design solution","dependsOn":[]},
  {"id":"s3","agent":"coder","description":"Implement code","dependsOn":["s1","s2"]},
  {"id":"s4","agent":"tester","description":"Validate tests","dependsOn":["s3"]},
  {"id":"s5","agent":"reviewer","description":"Review code","dependsOn":["s3"]},
  {"id":"s6","agent":"security","description":"Audit security","dependsOn":["s3"]},
  {"id":"s7","agent":"critic","description":"Challenge weaknesses","dependsOn":["s3"]}
]

DO NOT create linear chains. Researcher and Architect MUST be independent of each other.
DO NOT skip mandatory agents for complex coding tasks.
Output ONLY valid JSON.`,
    modelKey: "model-standard-chat",
    temperature: 0.1,
  },

  researcher: {
    name: "Researcher",
    role: "research",
    systemPrompt: `You are the Researcher agent. Gather technical context for the task.

Use read_file and run_command to explore relevant files. Summarize your findings concisely.

Output a structured report with sections:
## Context
## Key Findings
## Recommended Approach`,
    modelKey: "model-standard-fallback",
    temperature: 0.4,
  },

  architect: {
    name: "Architect",
    role: "architecture",
    systemPrompt: `You are the Architect agent. Design a technical implementation plan.

Given the research findings and requirements, produce:
## Architecture
## Component Design
## Data Flow
## Implementation Approach
## Files to Create/Modify`,
    modelKey: "model-standard-chat",
    temperature: 0.5,
  },

  coder: {
    name: "Coder",
    role: "coding",
    systemPrompt: `You are the Coder agent. Produce working implementations.

Use write_file to create files. Use run_command to verify syntax.

Output:
## Files Created
For each file, show the complete code with filename.`,
    modelKey: "model-standard-chat",
    temperature: 0.3,
  },

  tester: {
    name: "Tester",
    role: "testing",
    systemPrompt: `You are the Tester agent. Validate implementations.

Use read_file to examine code. Use run_command to execute tests.

Output:
## Test Results
## Issues Found
## Recommendations`,
    modelKey: "model-standard-fallback",
    temperature: 0.3,
  },

  security: {
    name: "Security",
    role: "security",
    systemPrompt: `You are the Security agent. Audit code for vulnerabilities.

Check for: hardcoded secrets, unsafe patterns, injection risks, permission issues, input validation gaps.

Output:
## Security Findings
## Risk Level (Critical/High/Medium/Low)
## Remediation Steps`,
    modelKey: "model-standard-chat",
    temperature: 0.3,
  },

  reviewer: {
    name: "Reviewer",
    role: "review",
    systemPrompt: `You are the Reviewer agent. Review code for correctness and maintainability.

Output:
## Correctness Review
## Maintainability Review
## Improvement Suggestions`,
    modelKey: "model-standard-fallback",
    temperature: 0.3,
  },

  critic: {
    name: "Critic",
    role: "critique",
    systemPrompt: `You are the Critic agent. Challenge assumptions and identify weaknesses.

Ask: What could go wrong? What edge cases are missed? What alternative approaches exist?

Output:
## Challenged Assumptions
## Identified Weaknesses
## Alternative Approaches`,
    modelKey: "model-standard-fallback",
    temperature: 0.6,
  },
};

// ── Context Compression ──────────────────────────────────────────────

/** Token budget per agent role — aggressive for speed */
const TOKEN_BUDGET: Record<string, number> = {
  planner: 200,
  researcher: 250,
  architect: 300,
  coder: 1500,
  tester: 300,
  reviewer: 300,
  security: 300,
  critic: 200,
  consensus: 600,
};

/** Compress agent output to a ≤300 token summary */
function compressOutput(output: string, agentName: string): string {
  if (!output || output.length < 200) return output || "(no output)";
  // Extract key sections: take first sentence of each paragraph
  const lines = output.split("\n").filter(l => l.trim().length > 10);
  const summary = lines.slice(0, 6).join("\n");
  const trimmed = summary.length > 500 ? summary.substring(0, 497) + "..." : summary;
  return `[${agentName} summary]: ${trimmed}`;
}

/** Get relevant upstream context for a specific agent */
function getAgentContext(agent: string, prevResults: AgentResult[]): string {
  // Build minimal context based on what this agent actually needs
  const contextParts: string[] = [];

  if (agent === "coder") {
    const research = prevResults.find(r => r.agent === "Researcher");
    const architect = prevResults.find(r => r.agent === "Architect");
    if (research) contextParts.push(compressOutput(research.output, "Research"));
    if (architect) contextParts.push(compressOutput(architect.output, "Architect"));
  } else if (agent === "tester" || agent === "reviewer" || agent === "security") {
    const coder = prevResults.find(r => r.agent === "Coder");
    const architect = prevResults.find(r => r.agent === "Architect");
    if (coder) contextParts.push(compressOutput(coder.output, "Coder"));
    if (architect && agent !== "tester") contextParts.push(compressOutput(architect.output, "Architect"));
  } else if (agent === "critic") {
    const reviewer = prevResults.find(r => r.agent === "Reviewer");
    const security = prevResults.find(r => r.agent === "Security");
    if (reviewer) contextParts.push(compressOutput(reviewer.output, "Reviewer"));
    if (security) contextParts.push(compressOutput(security.output, "Security"));
  } else if (agent === "consensus") {
    for (const r of prevResults) {
      contextParts.push(compressOutput(r.output, r.agent));
    }
  } else {
    // researcher, architect: just the last summary
    const last = prevResults[prevResults.length - 1];
    if (last) contextParts.push(compressOutput(last.output, last.agent));
  }

  return contextParts.join("\n\n") || "(no upstream context)";
}

// ── Agent Execution ───────────────────────────────────────────────────

async function runAgent(
  config: AgentConfig,
  stepDescription: string,
  previousResults: AgentResult[],
): Promise<AgentResult> {
  const t0 = Date.now();

  const upstreamContext = getAgentContext(config.name, previousResults);
  const tokenBudget = TOKEN_BUDGET[config.name] || 1500;
  const prompt = `## Task\n${stepDescription}\n\n## Upstream Context\n${upstreamContext}\n\nExecute your role. Be concise.`;

  try {
    const controller = new AbortController();
    const timeoutMs = 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const result = await generateText({
      model: myProvider.languageModel(config.modelKey),
      system: config.systemPrompt,
      prompt,
      temperature: config.temperature ?? 0.5,
      maxOutputTokens: tokenBudget,
      tools: sharedTools,
      stopWhen: (({ steps }: { steps: any[] }) => steps.length === 8) as any,
      abortSignal: controller.signal,
    });

    clearTimeout(timeout);

    const toolCalls = result.steps
      ? result.steps.filter((s: any) => s.toolCalls?.length > 0).reduce((sum: number, s: any) => sum + s.toolCalls.length, 0)
      : 0;

    return {
      agent: config.name,
      role: config.role,
      output: result.text,
      tokens: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
        total: result.usage?.totalTokens ?? 0,
      },
      durationMs: Date.now() - t0,
      toolCalls,
    };
  } catch (e: any) {
    return {
      agent: config.name,
      role: config.role,
      output: "",
      tokens: { input: 0, output: 0, total: 0 },
      durationMs: Date.now() - t0,
      toolCalls: 0,
      error: e.message || "Unknown error",
    };
  }
}

// ── Plan Execution ────────────────────────────────────────────────────

function buildExecutionDAG(steps: TaskStep[]): Map<string, string[]> {
  const dag = new Map<string, string[]>();
  // Topological sort: agents that have their dependencies met can run
  for (const step of steps) {
    dag.set(step.id, step.dependsOn || []);
  }
  return dag;
}

async function executeDAG(
  steps: TaskStep[],
  taskDescription: string,
  allResults: AgentResult[],
): Promise<AgentResult[]> {
  const dag = buildExecutionDAG(steps);
  const results: AgentResult[] = [];
  const completed = new Set<string>();
  const profiler = { layerTimes: [] as number[], totalWait: 0 };

  while (completed.size < steps.length) {
    const ready: TaskStep[] = [];

    for (const step of steps) {
      if (completed.has(step.id)) continue;
      const depsMet = step.dependsOn.every((depId) => completed.has(depId));
      if (depsMet) ready.push(step);
    }

    if (ready.length === 0) {
      for (const step of steps) {
        if (completed.has(step.id)) continue;
        ready.push(step);
      }
    }

    const layerStart = Date.now();

    const layerPromises = ready.map(async (step) => {
      const config = AGENTS[step.agent];
      if (!config) {
        const fake: AgentResult = {
          agent: step.agent, role: "unknown", output: `No agent config for "${step.agent}"`,
          tokens: { input: 0, output: 0, total: 0 }, durationMs: 0, toolCalls: 0,
          error: `Unknown agent: ${step.agent}`,
        };
        return { stepId: step.id, result: fake };
      }

      const context = `${step.description}\n\n${step.context || ""}\n\nTask: ${taskDescription}`;
      const result = await runAgent(config, context, [...allResults, ...results]);
      return { stepId: step.id, result };
    });

    const layerResults = await Promise.all(layerPromises);
    const layerDuration = Date.now() - layerStart;
    profiler.layerTimes.push(layerDuration);

    for (const { stepId, result } of layerResults) {
      results.push(result);
      completed.add(stepId);
    }

    // Compute parallel efficiency: if max single agent time = layer time, we're perfectly parallel
    const maxAgentTime = Math.max(...results.slice(-ready.length).map(r => r.durationMs), 1);
    const efficiency = Math.round((maxAgentTime / Math.max(layerDuration, 1)) * 100);
    const agentsInLayer = ready.map(s => s.agent).join(", ");
    console.error(`[profiler] layer ${profiler.layerTimes.length}: ${ready.length} agents [${agentsInLayer}] ${layerDuration}ms efficiency=${efficiency}%`);
  }

  const totalTime = profiler.layerTimes.reduce((a, b) => a + b, 0);
  console.error(`[profiler] total=${totalTime}ms layers=${profiler.layerTimes.length} avg=${Math.round(totalTime / profiler.layerTimes.length)}ms`);
  return results;
}

// ── Consensus Engine ──────────────────────────────────────────────────

async function runConsensus(
  results: AgentResult[],
  taskDescription: string,
): Promise<string> {
  // Use ONLY compressed summaries, never full raw outputs
  const summaries = results
    .map((r) => compressOutput(r.output, r.agent))
    .join("\n\n");

  const prompt = `## Task\n${taskDescription}\n\n## Agent Summaries\n${summaries}\n\nMerge all summaries into a single coherent final response. Resolve conflicts. Note which agents failed.`;

  try {
    const result = await generateText({
      model: myProvider.languageModel("model-standard-chat"),
      system: "Merge agent summaries into one final response. Be concise.",
      prompt,
      temperature: 0.4,
      maxOutputTokens: TOKEN_BUDGET.consensus || 1500,
    });

    return result.text;
  } catch (e: any) {
    return `Consensus failed: ${e.message}\n\nSummaries:\n${summaries}`;
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────

export async function executeOrchestration(
  taskDescription: string,
): Promise<OrchestrationResult> {
  const t0 = Date.now();
  const allResults: AgentResult[] = [];

  // Phase 1: Plan
  const planConfig = AGENTS.planner;
  const planResult = await runAgent(planConfig, taskDescription, []);
  allResults.push(planResult);

  // Parse the plan JSON from planner output
  let steps: TaskStep[] = [];
  try {
    const jsonMatch = planResult.output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      steps = JSON.parse(jsonMatch[0]);
    }

    // Phase validation: ensure complex tasks have mandatory agents
    const isComplex = taskDescription.length > 80 ||
      /test|audit|review|security|implement|multi|several|create.*and|build.*with/i.test(taskDescription);
    if (isComplex && steps.length > 0) {
      const present = new Set(steps.map((s: TaskStep) => s.agent));
      const mandatory = ["researcher", "architect", "coder", "tester", "reviewer"];
      const missing = mandatory.filter((a) => !present.has(a));
      if (missing.length > 0) {
        // Inject missing agents into the fallback DAG
        const fallbackSteps: TaskStep[] = [
          { id: "s1", description: "Research requirements", agent: "researcher", dependsOn: [] },
          { id: "s2", description: "Design architecture", agent: "architect", dependsOn: [] },
          { id: "s3", description: "Implement solution", agent: "coder", dependsOn: ["s1", "s2"] },
          { id: "s4", description: "Test implementation", agent: "tester", dependsOn: ["s3"] },
          { id: "s5", description: "Security audit", agent: "security", dependsOn: ["s3"] },
          { id: "s6", description: "Code review", agent: "reviewer", dependsOn: ["s3"] },
          { id: "s7", description: "Challenge assumptions", agent: "critic", dependsOn: ["s3"] },
        ];
        steps = fallbackSteps;
      }
    }
  } catch {
    // Fallback: parallel DAG
    steps = [
      { id: "s1", description: "Research requirements", agent: "researcher", dependsOn: [] },
      { id: "s2", description: "Design architecture", agent: "architect", dependsOn: [] },
      { id: "s3", description: "Implement solution", agent: "coder", dependsOn: ["s1", "s2"] },
      { id: "s4", description: "Test implementation", agent: "tester", dependsOn: ["s3"] },
      { id: "s5", description: "Security audit", agent: "security", dependsOn: ["s3"] },
      { id: "s6", description: "Code review", agent: "reviewer", dependsOn: ["s3"] },
      { id: "s7", description: "Challenge assumptions", agent: "critic", dependsOn: ["s3"] },
    ];
  }

  // Phase 2: Execute DAG
  const execResults = await executeDAG(steps, taskDescription, [planResult]);
  allResults.push(...execResults);

  // Phase 3: Consensus
  const consensus = await runConsensus(allResults, taskDescription);

  const totalDurationMs = Date.now() - t0;
  const totalTokens = allResults.reduce(
    (sum, r) => ({
      input: sum.input + r.tokens.input,
      output: sum.output + r.tokens.output,
      total: sum.total + r.tokens.total,
    }),
    { input: 0, output: 0, total: 0 },
  );

  // Build execution graph
  const execGraph: Record<string, string[]> = {};
  for (const step of steps) {
    execGraph[step.id] = [step.agent, ...step.dependsOn];
  }

  return {
    steps,
    results: allResults,
    executionGraph: execGraph,
    totalDurationMs,
    totalTokens,
    consensus,
    failureCount: allResults.filter((r) => r.error).length,
  };
}

// ── Intelligent Model Scheduler ─────────────────────────────────────

type TaskTier = "TRIVIAL" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE";

interface SchedulerConfig {
  tier: TaskTier;
  agents: string[];
  parallelGroups: string[][];
  modelRouting: Record<string, string>;
  timeouts: Record<string, number>;
  estimatedSteps: number;
}

const TIER_CONFIGS: Record<TaskTier, SchedulerConfig> = {
  TRIVIAL: {
    tier: "TRIVIAL",
    agents: ["coder"],
    parallelGroups: [["coder"]],
    modelRouting: { coder: "model-standard-fallback" },
    timeouts: { coder: 60_000 },
    estimatedSteps: 2,
  },
  SMALL: {
    tier: "SMALL",
    agents: ["coder", "reviewer"],
    parallelGroups: [["coder"], ["reviewer"]],
    modelRouting: { coder: "model-standard-chat", reviewer: "model-standard-fallback" },
    timeouts: { coder: 90_000, reviewer: 60_000 },
    estimatedSteps: 3,
  },
  MEDIUM: {
    tier: "MEDIUM",
    agents: ["coder", "tester", "reviewer"],
    parallelGroups: [["coder"], ["tester", "reviewer"]],
    modelRouting: {
      coder: "model-standard-chat",
      tester: "model-standard-fallback",
      reviewer: "model-standard-fallback",
    },
    timeouts: { coder: 90_000, tester: 60_000, reviewer: 60_000 },
    estimatedSteps: 3,
  },
  LARGE: {
    tier: "LARGE",
    agents: ["coder", "tester", "reviewer", "security", "critic"],
    parallelGroups: [["coder"], ["tester", "reviewer", "security", "critic"]],
    modelRouting: {
      coder: "model-standard-chat",
      tester: "model-standard-fallback",
      reviewer: "model-standard-fallback",
      security: "model-standard-fallback",
      critic: "model-standard-fallback",
    },
    timeouts: { coder: 90_000, tester: 60_000, reviewer: 60_000, security: 60_000, critic: 60_000 },
    estimatedSteps: 5,
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    agents: ["coder", "tester", "reviewer", "security", "critic"],
    parallelGroups: [["coder"], ["tester", "reviewer", "security", "critic"]],
    modelRouting: {
      coder: "model-standard-chat",
      tester: "model-standard-chat",
      reviewer: "model-standard-chat",
      security: "model-standard-chat",
      critic: "model-standard-chat",
    },
    timeouts: { coder: 90_000, tester: 60_000, reviewer: 60_000, security: 60_000, critic: 60_000 },
    estimatedSteps: 5,
  },
};

function classifyTask(description: string): TaskTier {
  const d = description.toLowerCase();
  const len = description.length;

  // TRIVIAL: single simple action
  if (len < 50 && !/test|audit|review|security|multi|several|deploy|build|architect/i.test(d)) {
    return "TRIVIAL";
  }

  // ENTERPRISE: comprehensive requests
  if (len > 300 || (d.includes("enterprise") && d.includes("audit")) ||
      (d.includes("full") && d.includes("penetration")) ||
      /comprehensive|production.grade|mission.critical/i.test(d)) {
    return "ENTERPRISE";
  }

  // LARGE: requests with security + tests + review
  const hasSecurity = /security|audit|vulnerability|exploit|penetration/i.test(d);
  const hasTests = /test|validate|verify/i.test(d);
  const hasReview = /review|critique/i.test(d);
  const hasMulti = /multi|several|create.*and|build.*with|implement.*and/i.test(d);

  if ((hasSecurity && hasTests) || (hasReview && hasTests && hasMulti) || len > 200) {
    return "LARGE";
  }

  // MEDIUM: moderate complexity
  if (hasTests || hasMulti || len > 100) {
    return "MEDIUM";
  }

  // SMALL: simple coding or single review
  if (/create|write|build|implement|code/i.test(d)) {
    return "SMALL";
  }

  return "MEDIUM";
}

function buildScheduledDAG(tier: TaskTier): TaskStep[] {
  const config = TIER_CONFIGS[tier];
  const steps: TaskStep[] = [];

  for (const agent of config.agents) {
    const deps: string[] = [];

    if (agent === "coder") {
      deps.push(...["researcher", "architect"].filter((a) => config.agents.includes(a)));
    }
    if (["tester", "reviewer", "security", "critic"].includes(agent)) {
      deps.push("coder");
    }

    steps.push({
      id: `s_${agent}`,
      description: `${agent} agent — ${tier} tier`,
      agent,
      dependsOn: deps,
    });
  }

  return steps;
}

function getAgentTimeout(agent: string, tier: TaskTier): number {
  return TIER_CONFIGS[tier].timeouts[agent] ?? 120_000;
}

function getAgentModel(agent: string, tier: TaskTier): string {
  return TIER_CONFIGS[tier].modelRouting[agent] ?? "model-standard-fallback";
}

/**
 * Scheduled orchestration: deterministic task classification → agent
 * selection → model routing → timeout policy. Skips the planner LLM
 * call entirely for known task tiers.
 */
export async function executeScheduled(
  taskDescription: string,
): Promise<OrchestrationResult & { tier: TaskTier; estimatedLatency: number }> {
  const t0 = Date.now();
  const allResults: AgentResult[] = [];

  // ── Mission Controller: owns execution lifecycle ──
  const mission = MissionController.create(taskDescription.substring(0, 80), taskDescription, [taskDescription]);
  mission.start();
  const critic = new MissionCritic();

  const tier = classifyTask(taskDescription);
  const config = TIER_CONFIGS[tier];
  const steps = buildScheduledDAG(tier);
  const estimatedLatency = config.estimatedSteps * 30_000;

  console.error(`[scheduler] tier=${tier} agents=${config.agents.length} groups=${config.parallelGroups.length} estLatency=${estimatedLatency}ms mission=${mission.getId()}`);

  // Phase 1: Execute scheduled DAG
  const execResults = await executeDAG(steps, taskDescription, allResults);
  allResults.push(...execResults);

  // Early exit: skip Critic if Reviewer + Security both pass
  const reviewerResult = allResults.find((r) => r.agent === "Reviewer" && !r.error);
  const securityResult = allResults.find((r) => r.agent === "Security" && !r.error);
  const criticResult = allResults.find((r) => r.agent === "Critic");

  if (reviewerResult && securityResult && criticResult && !criticResult.error) {
    const reviewPass = /no issues|pass|acceptable|good|appropriate/i.test(reviewerResult.output);
    const securityPass = /no (critical|high)|pass|acceptable|none found/i.test(securityResult.output);
    if (reviewPass && securityPass) {
      console.error(`[scheduler] early exit: skipping critic (reviewer+security pass)`);
      // Remove critic from results
      const criticIdx = allResults.indexOf(criticResult);
      if (criticIdx >= 0) allResults.splice(criticIdx, 1);
    }
  }

  // ── Goal Validator: never trust finishReason alone ──
  if (GoalValidator.neverTrustFinishReason(mission.getId()) === "replan") {
    console.error(`[goal-validator] mission=${mission.getId()} incomplete goals detected — would trigger replan`);
  }
  mission.update({ status: "completing" } as any);

  // Consensus optimization: skip if only 1 agent produced output
  const consensus = execResults.length <= 1
    ? execResults[0]?.output || "Task completed."
    : await runConsensus(allResults, taskDescription);

  const totalDurationMs = Date.now() - t0;
  const totalTokens = allResults.reduce(
    (sum, r) => ({
      input: sum.input + r.tokens.input,
      output: sum.output + r.tokens.output,
      total: sum.total + r.tokens.total,
    }),
    { input: 0, output: 0, total: 0 },
  );

  const execGraph: Record<string, string[]> = {};
  for (const step of steps) {
    execGraph[step.id] = [step.agent, ...step.dependsOn];
  }

  return {
    steps,
    results: allResults,
    executionGraph: execGraph,
    totalDurationMs,
    totalTokens,
    consensus,
    failureCount: allResults.filter((r) => r.error).length,
    tier,
    estimatedLatency,
  };
}// ── Simple single-task runner ─────────────────────────────────────────

export async function runSingleAgentTask(
  agentName: string,
  taskDescription: string,
  context?: string,
): Promise<AgentResult> {
  const config = AGENTS[agentName];
  if (!config) {
    return {
      agent: agentName,
      role: "unknown",
      output: "",
      tokens: { input: 0, output: 0, total: 0 },
      durationMs: 0,
      toolCalls: 0,
      error: `Unknown agent: ${agentName}`,
    };
  }
  return runAgent(config, `${taskDescription}${context ? "\n\nContext:\n" + context : ""}`, []);
}
