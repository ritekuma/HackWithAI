// ── Specialized Agent Training ──
// Every agent has its own policy, workflow, tools, memory, and profile.

import { getWorkflowEngine, runAutonomousWorkflow, WorkflowType } from "@/lib/mission/workflow";
import { getPolicyEngine, ExecutionPlan } from "@/lib/mission/policy";
import { MissionController, GoalValidator, ProgressScorer, MissionCritic } from "@/lib/mission/core";

// ── Agent Types ──────────────────────────────────────────────────────
export type AgentType = "builder" | "researcher" | "debugger" | "devops" | "qa" | "security";
export type AgentProfile = "autonomous" | "fast" | "balanced" | "safe";

export interface AgentConfig {
  id: AgentType;
  name: string;
  role: string;
  profile: AgentProfile;
  policy: string;
  workflow: WorkflowType;
  allowedTools: string[];
  systemPrompt: string;
  validationRules: string[];
}

export interface AgentMetrics {
  missionsTotal: number;
  missionsSuccess: number;
  avgDurationMs: number;
  repairCount: number;
  retryCount: number;
  lastUsed: number;
  failures: Record<string, number>;
}

// ── Agent Registry ────────────────────────────────────────────────────
const REGISTRY: Record<AgentType, AgentConfig> = {
  builder: {
    id: "builder", name: "Builder", role: "code-generation",
    profile: "autonomous", policy: "builder", workflow: "builder",
    allowedTools: ["run_terminal_cmd", "file_write", "file_read"],
    systemPrompt: `You are the Builder agent. Generate code, build, test, repair, and retry automatically. Never explain first — execute immediately. Verify everything. Repair automatically on failure. Report only after the mission is complete.`,
    validationRules: ["build_success", "tests_pass", "artifacts_exist"],
  },
  researcher: {
    id: "researcher", name: "Researcher", role: "research",
    profile: "autonomous", policy: "researcher", workflow: "research",
    allowedTools: ["run_terminal_cmd", "file_read", "web_search"],
    systemPrompt: `You are the Research agent. Collect data, search sources, compare findings, extract evidence, store artifacts, and generate reports.`,
    validationRules: ["sources_found", "evidence_collected", "report_generated"],
  },
  debugger: {
    id: "debugger", name: "Debugger", role: "debugging",
    profile: "autonomous", policy: "debugger", workflow: "debug",
    allowedTools: ["run_terminal_cmd", "file_read"],
    systemPrompt: `You are the Debugger agent. Collect logs, analyze stack traces, find root cause, generate patches, apply fixes, verify with tests, and retry.`,
    validationRules: ["bug_fixed", "tests_pass"],
  },
  devops: {
    id: "devops", name: "DevOps", role: "infrastructure",
    profile: "balanced", policy: "general", workflow: "general",
    allowedTools: ["run_terminal_cmd", "file_write"],
    systemPrompt: `You are the DevOps agent. Manage Docker containers, PM2 services, systemd units, Nginx configs, CI/CD pipelines, environments, deployments, and monitoring.`,
    validationRules: ["service_running", "deploy_success"],
  },
  qa: {
    id: "qa", name: "QA", role: "quality-assurance",
    profile: "balanced", policy: "general", workflow: "testing",
    allowedTools: ["run_terminal_cmd", "file_read"],
    systemPrompt: `You are the QA agent. Run unit tests, integration tests, regression tests, measure coverage, and validate outputs.`,
    validationRules: ["coverage_ok", "regression_clean"],
  },
  security: {
    id: "security", name: "Security Review", role: "security-audit",
    profile: "safe", policy: "researcher", workflow: "general",
    allowedTools: ["run_terminal_cmd", "file_read"],
    systemPrompt: `You are the Security Review agent. Operate only on authorized projects. Run static analysis, dependency reviews, configuration audits, secret detection, and code quality checks.`,
    validationRules: ["scan_complete", "issues_documented"],
  },
};

// ── Agent Manager ─────────────────────────────────────────────────────
export class AgentManager {
  private metrics = new Map<AgentType, AgentMetrics>();
  private experience = new Map<AgentType, string[]>();

  constructor() {
    for (const type of Object.keys(REGISTRY) as AgentType[]) {
      this.metrics.set(type, {
        missionsTotal: 0, missionsSuccess: 0, avgDurationMs: 0,
        repairCount: 0, retryCount: 0, lastUsed: 0, failures: {},
      });
    }
  }

  select(task: string): AgentConfig {
    const t = task.toLowerCase();
    // Check specialized patterns FIRST before general builder
    if (/debug|fix|repair|bug|crash|error|patch/i.test(t)) return REGISTRY.debugger;
    if (/research|search|find|collect|analyze|report|evidence|osint/i.test(t)) return REGISTRY.researcher;
    if (/docker|pm2|systemd|nginx|deploy|ci.cd|monitor|infrastructure/i.test(t)) return REGISTRY.devops;
    if (/test|qa|quality|coverage|regression|validation/i.test(t)) return REGISTRY.qa;
    if (/security|audit|vulnerability|scan|secret|permission/i.test(t)) return REGISTRY.security;
    if (/build|create|generate|code|implement|script|refactor/i.test(t)) return REGISTRY.builder;
    return REGISTRY.builder;
  }

  /** Record mission result for the agent */
  record(agent: AgentType, success: boolean, durationMs: number, retries: number, failure?: string) {
    const m = this.metrics.get(agent)!;
    m.missionsTotal++;
    if (success) m.missionsSuccess++;
    m.avgDurationMs = Math.round((m.avgDurationMs * (m.missionsTotal - 1) + durationMs) / m.missionsTotal);
    m.retryCount += retries;
    m.lastUsed = Date.now();
    if (failure) m.failures[failure] = (m.failures[failure] || 0) + 1;
  }

  getMetrics(agent: AgentType): AgentMetrics { return this.metrics.get(agent)!; }
  getConfig(agent: AgentType): AgentConfig { return REGISTRY[agent]; }
  listAgents(): AgentConfig[] { return Object.values(REGISTRY); }

  /** Select and run the best agent for a task */
  async run(task: string): Promise<{
    agent: AgentType; agentName: string; missionId: string;
    success: boolean; stages: number; retries: number; message: string;
  }> {
    const agent = this.select(task);
    const t0 = Date.now();

    const engine = getWorkflowEngine();
    const mission = MissionController.create(task.substring(0, 80), task, [`${agent.name}: ${task}`]);
    mission.start();
    mission.update({ status: "running" } as any);

    console.info(`[agent-manager] selected=${agent.name} type=${agent.id} profile=${agent.profile} workflow=${agent.workflow}`);

    const wfResult = await engine.run(mission.getId(), task);
    const durationMs = Date.now() - t0;
    this.record(agent.id, wfResult.success, durationMs, wfResult.stages);

    if (wfResult.success) mission.complete(); else mission.fail("Workflow failed");

    return {
      agent: agent.id, agentName: agent.name, missionId: mission.getId(),
      success: wfResult.success, stages: wfResult.stages, retries: wfResult.stages,
      message: wfResult.message,
    };
  }

  getRegistry() { return REGISTRY; }
}

// ── Singleton ─────────────────────────────────────────────────────────
let _manager: AgentManager | null = null;
export function getAgentManager(): AgentManager {
  if (!_manager) _manager = new AgentManager();
  return _manager;
}
