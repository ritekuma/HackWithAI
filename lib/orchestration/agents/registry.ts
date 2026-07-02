// ── Agent Registry ──
// Maps every existing Python agent into the orchestration layer.
// No new agents created — these are wrappers around existing implementations.

import type { AgentDefinition, AgentRole } from "../types";

export const AGENT_REGISTRY: AgentDefinition[] = [
  // ── Planner ──
  {
    id: "planner-agent",
    name: "Planner Agent",
    role: "planner",
    description: "Decomposes complex security tasks into structured phases. Generates attack plans with tool assignments and execution order.",
    capabilities: ["task-decomposition", "attack-planning", "phase-sequencing", "tool-selection"],
    supportedTools: ["web_search", "open_url", "list_notes", "todo_write"],
    supportedModels: ["agent-planner"],
    executionMode: "sequential",
    timeout: 120,
    costClass: "standard",
    dependencies: [],
    pythonModule: "swarm.agents.PlannerAgent",
    active: true,
  },

  // ── Researcher ──
  {
    id: "researcher-agent",
    name: "Researcher Agent",
    role: "researcher",
    description: "Gathers intelligence using memory search and tool execution. Searches knowledge base, runs reconnaissance tools, collects findings.",
    capabilities: ["web-search", "knowledge-retrieval", "memory-search", "reconnaissance"],
    supportedTools: ["web_search", "open_url", "list_notes", "run_terminal_cmd"],
    supportedModels: ["agent-researcher"],
    executionMode: "parallel",
    timeout: 180,
    costClass: "cheap",
    dependencies: [],
    pythonModule: "swarm.agents.ResearcherAgent",
    active: true,
  },

  // ── Coder ──
  {
    id: "coder-agent",
    name: "Coder Agent",
    role: "coder",
    description: "Generates Python/Bash code for security operations. Creates exploit scripts, payload generators, automation tools.",
    capabilities: ["code-generation", "script-creation", "payload-generation"],
    supportedTools: ["file", "desktop_execute", "run_terminal_cmd", "desktop_file_write"],
    supportedModels: ["agent-coder"],
    executionMode: "sequential",
    timeout: 300,
    costClass: "standard",
    dependencies: ["planner-agent"],
    pythonModule: "swarm.agents.CoderAgent",
    active: true,
  },

  // ── Reviewer ──
  {
    id: "reviewer-agent",
    name: "Reviewer Agent",
    role: "reviewer",
    description: "Multi-factor review of agent outputs. Scores quality, checks for errors, validates security impact.",
    capabilities: ["output-review", "quality-scoring", "error-detection", "security-validation"],
    supportedTools: ["list_notes", "file"],
    supportedModels: ["agent-reviewer"],
    executionMode: "sequential",
    timeout: 120,
    costClass: "standard",
    dependencies: [],
    pythonModule: "agents.reviewer_agent",
    active: true,
  },

  // ── Critic ──
  {
    id: "critic-agent",
    name: "Critic Agent",
    role: "critic",
    description: "Aggressive quality critique. Finds flaws, identifies weaknesses, challenges assumptions.",
    capabilities: ["quality-critique", "flaw-detection", "assumption-challenge"],
    supportedTools: ["list_notes"],
    supportedModels: ["agent-critic"],
    executionMode: "sequential",
    timeout: 90,
    costClass: "standard",
    dependencies: [],
    pythonModule: "agents.critic_agent",
    active: true,
  },

  // ── Consensus Engine ──
  {
    id: "consensus-engine",
    name: "Consensus Engine",
    role: "consensus",
    description: "Round-based voting system. Requires 0.6 threshold. Tiebreaker with faceoff. Finalization to JSON.",
    capabilities: ["voting", "tiebreaking", "consensus-building"],
    supportedTools: [],
    supportedModels: [],
    executionMode: "consensus",
    timeout: 60,
    costClass: "cheap",
    dependencies: [],
    pythonModule: "agents.consensus_engine",
    active: true,
  },

  // ── Debate Engine ──
  {
    id: "debate-engine",
    name: "Debate Engine",
    role: "debate",
    description: "Multi-agent debate system. Parallel agents argue attack strategies through rounds of argumentation.",
    capabilities: ["multi-agent-debate", "strategy-argumentation", "parallel-reasoning"],
    supportedTools: [],
    supportedModels: ["agent-debate"],
    executionMode: "debate",
    timeout: 300,
    costClass: "expensive",
    dependencies: [],
    pythonModule: "agents.debate_engine",
    active: true,
  },

  // ── Optimizer ──
  {
    id: "optimizer-agent",
    name: "Optimizer Agent",
    role: "optimizer",
    description: "Recommends optimal tools and models for a given task. Analyzes past performance and cost tradeoffs.",
    capabilities: ["tool-optimization", "model-selection", "cost-analysis"],
    supportedTools: [],
    supportedModels: ["agent-optimizer"],
    executionMode: "sequential",
    timeout: 60,
    costClass: "cheap",
    dependencies: [],
    pythonModule: "swarm.agents.OptimizerAgent",
    active: true,
  },

  // ── Self Improvement ──
  {
    id: "self-improvement",
    name: "Self Improvement Engine",
    role: "self_improvement",
    description: "Tracks tool execution outcomes, learns success patterns, builds SkillRecord and StrategyPattern knowledge base.",
    capabilities: ["outcome-tracking", "pattern-learning", "skill-recording"],
    supportedTools: ["create_note", "list_notes", "update_note"],
    supportedModels: ["agent-optimizer"],
    executionMode: "sequential",
    timeout: 120,
    costClass: "cheap",
    dependencies: [],
    pythonModule: "agents.self_improvement",
    active: true,
  },

  // ── Orchestrator ──
  {
    id: "hermes-coordinator",
    name: "Hermes Coordinator",
    role: "orchestrator",
    description: "Master multi-agent pipeline: Plan → Debate → Consensus → Critic → Review → Revise → Output. Registers 8 agent roles.",
    capabilities: ["multi-agent-pipeline", "task-orchestration", "result-synthesis"],
    supportedTools: ["web_search", "open_url", "run_terminal_cmd", "file", "todo_write"],
    supportedModels: ["agent-coordinator"],
    executionMode: "sequential",
    timeout: 600,
    costClass: "expensive",
    dependencies: ["planner-agent", "debate-engine", "consensus-engine", "critic-agent", "reviewer-agent"],
    pythonModule: "agents.hermes_coordinator",
    active: true,
  },
];

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getAgentsByRole(role: AgentRole): AgentDefinition[] {
  return AGENT_REGISTRY.filter((a) => a.role === role && a.active);
}

export function getActiveAgents(): AgentDefinition[] {
  return AGENT_REGISTRY.filter((a) => a.active);
}
