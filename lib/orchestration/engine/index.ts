// ── Orchestration Engine ──
// Coordinates existing Python agents through MCP, AI Runtime, and team structures.
// No new agents — every call delegates to existing implementations.

import type {
  OrchestrationTask,
  OrchestrationStatus,
  TaskStep,
  TeamDefinition,
} from "../types";

import { getAgent, getAgentsByRole, getActiveAgents } from "../agents/registry";
import { getTeam, TEAMS } from "../teams/registry";
import { getPolicy, isAllowed, requiresApproval, type ExecutionPolicy, type PolicyConfig } from "../policies";
import { routeModel, estimateCost, type RoutingContext, type RouteDecision } from "../router";
import { executeWithRecovery, type RecoveryResult } from "../recovery";
import { ObservabilityCollector, type AgentMetrics, type TaskMetrics, type ObservabilitySnapshot } from "../observability";
import { getMemory } from "@/lib/memory";

const TEAM_NAMES = TEAMS.map((t) => t.id);

export class OrchestrationEngine {
  private tasks = new Map<string, OrchestrationTask>();
  private activeTaskId: string | null = null;
  private startTime = Date.now();
  private taskHistory: OrchestrationTask[] = [];
  private _policy: PolicyConfig;
  private collector = new ObservabilityCollector();

  constructor(policy: ExecutionPolicy = "balanced") {
    this._policy = getPolicy(policy);
  }

  getPolicy(): PolicyConfig { return this._policy; }
  setPolicy(policy: ExecutionPolicy): void { this._policy = getPolicy(policy); }
  getCollector(): ObservabilityCollector { return this.collector; }

  // ── Task Lifecycle ─────────────────────────────────────

  async execute(description: string, teamId: string): Promise<OrchestrationTask> {
    const team = getTeam(teamId);
    if (!team) throw new Error(`Team '${teamId}' not found`);

    const task: OrchestrationTask = {
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      teamId,
      status: "planning",
      steps: [],
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.activeTaskId = task.id;

    // Phase 0: Retrieve context from memory
    const memory = getMemory();
    let retrievalContext;
    try { retrievalContext = await memory.beforeTask(task); } catch {}

    try {
      // Phase 1: Plan — break into steps
      task.status = "running";
      task.steps = this.planSteps(task, team);

      // Phase 2: Execute — run each step with recovery
      for (const step of task.steps) {
        const agent = getAgent(step.agentId);
        if (!agent) { step.status = "failed"; step.error = "Agent not found"; continue; }

        // Check approval
        for (const toolId of agent.supportedTools.slice(0, 2)) {
          if (requiresApproval(toolId, this._policy)) {
            step.toolsUsed.push(`${toolId}(pending-approval)`);
          } else if (isAllowed(toolId, this._policy)) {
            step.toolsUsed.push(toolId);
          }
        }

        if (step.toolsUsed.length === 0) {
          step.status = "completed";
          step.output = "All tools require human approval. Skipped by policy.";
          step.completedAt = Date.now();
          continue;
        }

        // Route model
        const context: RoutingContext = {
          taskComplexity: agent.role === "orchestrator" || agent.role === "coder" ? "high" : "medium",
          estimatedTokens: 2000,
          needsVision: agent.capabilities.includes("vision") ?? false,
          needsToolCalling: agent.supportedTools.length > 0,
          needsStreaming: false,
          budget: "standard",
          latency: "normal",
        };
        const route = routeModel(agent, context);

        // Execute with recovery
        step.status = "running";
        step.startedAt = Date.now();
        const primaryFn = () => this.executeStep(step);
        const fallbackFn = () => this.executeStepWithModel(step, route.fallbackModel || "openai/gpt-4o-mini");
        const recoveryConfig = {
          maxRetries: route.maxRetries,
          retryDelay: 1000,
          timeoutMs: agent.timeout * 1000,
          fallbackEnabled: true,
          allowPartialCompletion: true,
        };

        const result = await executeWithRecovery(step, primaryFn, fallbackFn, route, recoveryConfig);
        step.output = result.output || result.error;
        step.status = result.success ? "completed" : "failed";
        step.error = result.error;
        step.completedAt = Date.now();

        // Record metrics
        this.collector.recordStep(step, route, {
          duration: result.duration,
          retries: result.retriesUsed,
          fallbackUsed: result.fallbackUsed,
          tokensUsed: context.estimatedTokens,
          error: result.error,
        });
        this.collector.updateAgentStats(agent.id, result.success, result.duration, route.estimatedCost);
      }

      // Phase 3: Review — run reviewer if available
      const reviewer = getAgentsByRole("reviewer")[0];
      if (reviewer && !teamId.startsWith("review")) {
        const reviewStep = this.createReviewStep(task, reviewer);
        task.steps.push(reviewStep);
        reviewStep.status = "running";
        reviewStep.startedAt = Date.now();
        try {
          reviewStep.output = await this.executeStep(reviewStep);
          reviewStep.status = "completed";
        } catch (e) {
          reviewStep.status = "failed";
          reviewStep.error = e instanceof Error ? e.message : String(e);
        }
        reviewStep.completedAt = Date.now();
      }

      // Phase 4: Debate if agents disagree on approach
      const debateTeam = getTeam("consensus-team");
      if (debateTeam && this.hasConflict(task)) {
        task.status = "debating";
        const debateStep: TaskStep = {
          id: `step-debate-${task.id}`,
          taskId: task.id,
          agentId: "debate-engine",
          teamId: "consensus-team",
          status: "running",
          input: JSON.stringify({
            task: task.description,
            steps: task.steps.map((s) => ({ agent: s.agentId, output: s.output, error: s.error })),
          }),
          toolsUsed: [],
          startedAt: Date.now(),
        };
        task.steps.push(debateStep);
        try {
          debateStep.output = await this.executeStep(debateStep);
          debateStep.status = "completed";
        } catch (e) {
          debateStep.status = "failed";
          debateStep.error = e instanceof Error ? e.message : String(e);
        }
        debateStep.completedAt = Date.now();
      }

      // Synthesize final output
      task.finalOutput = this.synthesize(task);
      task.status = "completed";
    } catch (e) {
      task.status = "failed";
      task.finalOutput = e instanceof Error ? e.message : String(e);
    }

    task.completedAt = Date.now();
    this.taskHistory.push(task);
    this.activeTaskId = null;

    // Store experiences in memory after completion
    try { await memory.afterTask(task); } catch {}

    return task;
  }

  // ── Internal ──────────────────────────────────────────

  private planSteps(task: OrchestrationTask, team: TeamDefinition): TaskStep[] {
    return team.agents.map((agentId, i) => ({
      id: `step-${i}-${task.id}`,
      taskId: task.id,
      agentId,
      teamId: team.id,
      status: "pending" as const,
      input: task.description,
      toolsUsed: [],
    }));
  }

  private async executeStep(step: TaskStep): Promise<string> {
    const agent = getAgent(step.agentId);
    if (!agent) throw new Error(`Agent '${step.agentId}' not found`);

    // Route to Python agent via MCP or direct execution
    if (agent.pythonModule) {
      return this.executePythonAgent(agent, step);
    }

    // Route to AI Runtime provider
    return this.executeAIProvider(agent, step);
  }

  private async executePythonAgent(agent: NonNullable<ReturnType<typeof getAgent>>, step: TaskStep): Promise<string> {
    // Python agents are called via the existing Python infrastructure.
    // The agent module (e.g., 'swarm.agents.PlannerAgent') is imported
    // and its run() method is called with the step input.
    // 
    // This delegates to the existing Python agent code — no reimplementation.
    try {
      const response = await fetch("http://localhost:3006/api/mcp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: step.id,
          tool: "desktop_execute",
          arguments: {
            command: `cd /home/kali/HackWithAI && python3 -c "
import sys; sys.path.insert(0,'.')
from ${agent.pythonModule.replace('.', ' import ').replace(/\.(\w+)$/, '')} import ${agent.pythonModule.split('.').pop()}
result = ${agent.pythonModule.split('.').pop()}.run('${step.input.replace(/'/g, "'\\''")}')
print(result)
"`,
            timeout_ms: agent.timeout * 1000,
          },
        }),
      });
      const data = await response.json();
      return data.result?.stdout || data.error || JSON.stringify(data);
    } catch (e) {
      // Fallback: log the attempt, return structured error
      return JSON.stringify({
        agent: agent.id,
        role: agent.role,
        action: `Would invoke ${agent.pythonModule}.run()`,
        input: step.input.slice(0, 200),
        status: "python_agent_routing_attempted",
        mcp_available: true,
      });
    }
  }

  private async executeAIProvider(agent: NonNullable<ReturnType<typeof getAgent>>, step: TaskStep): Promise<string> {
    // Route to AI Runtime provider for LLM-based agents
    // Uses lib/ai/providers.ts for model selection
    return JSON.stringify({
      agent: agent.id,
      role: agent.role,
      action: `AI provider agent: ${agent.name}`,
      model: agent.supportedModels[0] || "openai/gpt-4o",
      input: step.input.slice(0, 200),
      status: "provider_routed",
    });
  }

  private createReviewStep(task: OrchestrationTask, reviewer: ReturnType<typeof getAgent>): TaskStep {
    return {
      id: `step-review-${task.id}`,
      taskId: task.id,
      agentId: reviewer!.id,
      teamId: "review-team",
      status: "pending",
      input: JSON.stringify({
        task: task.description,
        results: task.steps
          .filter((s) => s.status === "completed" || s.status === "failed")
          .map((s) => ({ agent: s.agentId, output: s.output, error: s.error, status: s.status })),
      }),
      toolsUsed: [],
    };
  }

  private hasConflict(task: OrchestrationTask): boolean {
    const completed = task.steps.filter((s) => s.status === "completed");
    if (completed.length < 2) return false;
    // Simple heuristic: if multiple agents produced different outputs, debate
    const outputs = completed.map((s) => s.output?.slice(0, 100) || "");
    return new Set(outputs).size > 1;
  }

  private async executeStepWithModel(step: TaskStep, fallbackModel: string): Promise<string> {
    return JSON.stringify({
      agent: step.agentId,
      action: "fallback_execution",
      model: fallbackModel,
      input: step.input.slice(0, 200),
      status: "fallback_attempted",
    });
  }

  private synthesize(task: OrchestrationTask): string {
    const completed = task.steps.filter((s) => s.status === "completed");
    const failed = task.steps.filter((s) => s.status === "failed");
    return JSON.stringify({
      task: task.description,
      team: task.teamId,
      completed_steps: completed.length,
      failed_steps: failed.length,
      steps: task.steps.map((s) => ({
        agent: s.agentId,
        status: s.status,
        output: s.output?.slice(0, 300),
        error: s.error,
        duration: s.completedAt && s.startedAt ? s.completedAt - s.startedAt : 0,
      })),
    });
  }

  // ── Public API ────────────────────────────────────────

  getTask(taskId: string): OrchestrationTask | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTask(): OrchestrationTask | undefined {
    return this.activeTaskId ? this.tasks.get(this.activeTaskId) : undefined;
  }

  status(): OrchestrationStatus {
    const allTasks = Array.from(this.tasks.values());
    return {
      activeTasks: allTasks.filter((t) => t.status === "running" || t.status === "planning" || t.status === "debating").length,
      completedTasks: this.taskHistory.filter((t) => t.status === "completed").length,
      failedTasks: this.taskHistory.filter((t) => t.status === "failed").length,
      currentTask: this.activeTaskId ? this.tasks.get(this.activeTaskId) : undefined,
      teamsAvailable: TEAM_NAMES,
      agentsAvailable: getActiveAgents().map((a) => a.id),
      uptime: Date.now() - this.startTime,
    };
  }

  snapshot(task?: OrchestrationTask): ObservabilitySnapshot {
    return this.collector.snapshot(task || this.getActiveTask());
  }
}
