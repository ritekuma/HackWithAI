// ── Mission Planner ──
// Converts mission objectives into structured plans using existing agents.
// Reuses OrchestrationEngine for planning-agent execution.

import type { MissionDefinition, MissionPlan, MissionGoal, MissionMilestone } from "./types";
import { getTeam } from "@/lib/orchestration/teams/registry";
import { getAgent, getAgentsByRole } from "@/lib/orchestration/agents/registry";

const PLANNING_TEMPLATES: Record<string, { teams: string[]; description: string }> = {
  security_scan: {
    teams: ["recon-team", "exploit-team", "review-team"],
    description: "Security assessment pipeline: reconnaissance → exploitation → reporting",
  },
  code_audit: {
    teams: ["dev-team", "review-team"],
    description: "Code review pipeline: analysis → review → recommendations",
  },
  infrastructure: {
    teams: ["ops-team", "review-team"],
    description: "Infrastructure audit: scanning → hardening → validation",
  },
  generic: {
    teams: ["planning-team", "recon-team", "dev-team", "review-team"],
    description: "Full pipeline: plan → research → develop → review",
  },
};

export function classifyMission(objective: string): string {
  const lower = objective.toLowerCase();
  if (lower.includes("scan") || lower.includes("pentest") || lower.includes("vulnerability")) return "security_scan";
  if (lower.includes("code") || lower.includes("audit") || lower.includes("review")) return "code_audit";
  if (lower.includes("infrastructure") || lower.includes("server") || lower.includes("deploy")) return "infrastructure";
  return "generic";
}

export function planMission(mission: MissionDefinition): MissionPlan {
  const category = classifyMission(mission.objective);
  const template = PLANNING_TEMPLATES[category] || PLANNING_TEMPLATES.generic;

  const goals: MissionGoal[] = template.teams.map((teamId, i) => {
    const team = getTeam(teamId);
    return {
      id: `goal-${mission.id}-${i}`,
      description: team?.description || `Execute ${teamId}`,
      status: "pending" as const,
      milestones: [{
        id: `ms-${mission.id}-${i}-0`,
        goalId: `goal-${mission.id}-${i}`,
        description: team?.triggerDescription || "Execute team tasks",
        order: i,
        status: "pending" as const,
        tasks: team?.agents.map((agentId, j) => ({
          id: `task-${mission.id}-${i}-${j}`,
          milestoneId: `ms-${mission.id}-${i}-0`,
          description: `Agent ${agentId}: ${mission.objective.slice(0, 100)}`,
          teamId,
          agentId,
          status: "pending" as const,
          dependencies: j > 0 ? [`task-${mission.id}-${i}-${j - 1}`] : [],
          estimatedDuration: 120,
        })) || [],
      }],
    };
  });

  const allAgents = new Set<string>();
  const allTools = new Set<string>();
  for (const goal of goals) {
    for (const ms of goal.milestones) {
      for (const task of ms.tasks) {
        if (task.agentId) allAgents.add(task.agentId);
        const agent = getAgent(task.agentId || "");
        if (agent) agent.supportedTools.forEach((t) => allTools.add(t));
      }
    }
  }

  return {
    missionId: mission.id,
    goals,
    estimatedCost: goals.length * 0.10,
    estimatedDuration: goals.reduce((s, g) => s + g.milestones.reduce((ss, m) => ss + m.tasks.reduce((sss, t) => sss + t.estimatedDuration, 0), 0), 0),
    requiredAgents: Array.from(allAgents),
    requiredTools: Array.from(allTools),
    risks: ["network connectivity", "tool availability", "approval delays"],
  };
}
