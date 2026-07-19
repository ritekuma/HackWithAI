// @module governance/policy-engine v1.0.0 — Domain-specific policy evaluation

import type { PolicyDecision } from "./rule-engine";
import { evaluatePolicy } from "./rule-engine";

export type MissionPolicy = "autonomous" | "fast" | "balanced" | "safe";

export interface MissionValidationInput {
  missionId: string;
  goal: string;
  policy: MissionPolicy;
  userId?: string;
  workspaceId?: string;
  estimatedTools: string[];
  estimatedTokens: number;
  estimatedDurationMs: number;
}

export function validateMission(input: MissionValidationInput): PolicyDecision {
  const actions = ["sprint_completion", "start_implementation"];
  if (input.policy === "safe") {
    return evaluatePolicy({
      action: actions.includes("start_implementation") ? "start_implementation" : "sprint_completion",
      mission_policy: input.policy,
    });
  }

  return {
    allowed: true,
    effect: "allow",
    reasons: [`Mission ${input.missionId}: allowed under ${input.policy} policy`],
    requiresEvidence: true,
    requiresApproval: false,
    requiresVerification: true,
    requiresAudit: false,
    requiresHumanReview: false,
    blockingRules: [],
    results: [],
  };
}

export interface ToolAuthorizationInput {
  toolName: string;
  command?: string;
  workspaceId?: string;
  missionId?: string;
  chatId?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  policy: MissionPolicy;
}

export function authorizeTool(input: ToolAuthorizationInput): PolicyDecision {
  // Dangerous commands require special handling
  const dangerous = /rm -rf|sudo|chmod 777|wget.*\|.*sh|curl.*\|.*bash|mkfs|dd if=|:(){ :\|:& };:/i;

  if (dangerous.test(input.command || "")) {
    const result = evaluatePolicy({
      action: "tool_execution",
      tool_name: input.toolName,
      command: input.command?.substring(0, 100),
      risk_level: "critical",
      policy: input.policy,
      finding_severity: "HIGH",
    });

    // Under safe policy, dangerous commands require human review
    if (input.policy === "safe") {
      result.requiresHumanReview = true;
      result.reasons.push("Dangerous command requires human review under safe policy");
    }

    return result;
  }

  if (input.riskLevel === "high" || input.riskLevel === "critical") {
    const result = evaluatePolicy({
      action: "tool_execution",
      tool_name: input.toolName,
      risk_level: input.riskLevel,
      policy: input.policy,
    });

    if (input.policy === "safe") {
      result.requiresApproval = true;
    }

    return result;
  }

  return {
    allowed: true,
    effect: "allow",
    reasons: [`Tool '${input.toolName}': allowed`],
    requiresEvidence: false,
    requiresApproval: false,
    requiresVerification: false,
    requiresAudit: false,
    requiresHumanReview: false,
    blockingRules: [],
    results: [],
  };
}

export interface RecoveryAuthorizationInput {
  faultType: string;
  target: string;
  chatId?: string;
  missionId?: string;
  severity: string;
}

export function authorizeRecovery(input: RecoveryAuthorizationInput): PolicyDecision {
  return {
    allowed: true,
    effect: "allow",
    reasons: [`Recovery '${input.faultType}' on '${input.target}': authorized`],
    requiresEvidence: true,
    requiresApproval: false,
    requiresVerification: true,
    requiresAudit: true,
    requiresHumanReview: input.severity === "SEV-0",
    blockingRules: [],
    results: [],
  };
}

export interface ExecutiveAuthorizationInput {
  executiveId: string;
  executiveName: string;
  missionId?: string;
  chatId?: string;
  decision: string;
  confidence: number;
}

export function authorizeExecutive(input: ExecutiveAuthorizationInput): PolicyDecision {
  if (input.confidence < 0.3) {
    return {
      allowed: false,
      effect: "deny",
      reasons: [`Executive '${input.executiveName}': confidence too low (${input.confidence})`],
      requiresEvidence: true,
      requiresApproval: true,
      requiresVerification: true,
      requiresAudit: true,
      requiresHumanReview: true,
      blockingRules: ["C12.3"],
      results: [],
    };
  }

  return {
    allowed: true,
    effect: "allow",
    reasons: [`Executive '${input.executiveName}': decision authorized (confidence: ${input.confidence})`],
    requiresEvidence: input.confidence < 0.7,
    requiresApproval: input.confidence < 0.5,
    requiresVerification: true,
    requiresAudit: input.confidence < 0.9,
    requiresHumanReview: false,
    blockingRules: [],
    results: [],
  };
}

export interface WorkspacePolicyInput {
  workspaceId: string;
  action: "create" | "delete" | "modify" | "execute";
  filePath?: string;
  command?: string;
  policy: MissionPolicy;
}

export function evaluateWorkspacePolicy(input: WorkspacePolicyInput): PolicyDecision {
  const riskyPaths = /^\/etc\b|^\/root\b|^\/boot\b|^\/sys\b|^\/proc\b/;

  if (input.filePath && riskyPaths.test(input.filePath)) {
    return {
      allowed: false,
      effect: "deny",
      reasons: [`File path '${input.filePath}' is in a protected system directory`],
      requiresEvidence: true,
      requiresApproval: true,
      requiresVerification: true,
      requiresAudit: true,
      requiresHumanReview: true,
      blockingRules: [],
      results: [],
    };
  }

  return {
    allowed: true,
    effect: "allow",
    reasons: [`Workspace action '${input.action}' on '${input.workspaceId}': allowed`],
    requiresEvidence: false,
    requiresApproval: false,
    requiresVerification: false,
    requiresAudit: false,
    requiresHumanReview: false,
    blockingRules: [],
    results: [],
  };
}
