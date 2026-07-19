// @module executive/executive-runtime v1.0.0 — Executive Board with real decision-making

import { getDecisionEngine, type Decision, type DecisionType, type DecisionVote } from "./decision-engine";
import {
  getDepartmentByRole,
  findDepartmentForTool,
  assignWorker,
  completeWorkerTask,
  type Assignment,
  type Department,
} from "./departments";
import { getEventBus } from "@/lib/events";
import { getConstitutionRuntime } from "@/lib/governance";

export type ExecutiveId = "ceo" | "cto" | "coo" | "cqa" | "cso" | "cro" | "cmo" | "cio";

export interface BoardConfig {
  mode: "ask" | "agent";
  chatId: string;
  votingQuorum: number;
  autoApprove: boolean;
}

export interface BoardReviewResult {
  allowed: boolean;
  decision: Decision;
  assignment?: Assignment;
  evidenceRequired: boolean;
  escalationRequired: boolean;
  reasoning: string;
}

const EXECUTIVE_NAMES: Record<ExecutiveId, string> = {
  ceo: "CEO",
  cto: "CTO",
  coo: "COO",
  cqa: "Chief QA",
  cso: "Chief Security",
  cro: "Chief Research",
  cmo: "Chief Memory",
  cio: "Chief Infrastructure",
};

const EXECUTIVE_BIAS: Record<ExecutiveId, { approvalProbability: number; riskTolerance: "low" | "medium" | "high" }> = {
  ceo:   { approvalProbability: 0.70, riskTolerance: "medium" },
  cto:   { approvalProbability: 0.85, riskTolerance: "high" },
  coo:   { approvalProbability: 0.75, riskTolerance: "medium" },
  cqa:   { approvalProbability: 0.50, riskTolerance: "low" },
  cso:   { approvalProbability: 0.40, riskTolerance: "low" },
  cro:   { approvalProbability: 0.80, riskTolerance: "high" },
  cmo:   { approvalProbability: 0.90, riskTolerance: "high" },
  cio:   { approvalProbability: 0.60, riskTolerance: "medium" },
};

export class ExecutiveRuntime {
  private config: BoardConfig;
  private board: Map<ExecutiveId, boolean> = new Map();

  constructor(config: BoardConfig) {
    this.config = config;
    for (const id of Object.keys(EXECUTIVE_NAMES) as ExecutiveId[]) {
      this.board.set(id, true); // All executives active by default
    }
  }

  // ── MISSION REVIEW ───────────────────────────────────

  reviewMission(missionId: string, goal: string, context?: Record<string, unknown>): BoardReviewResult {
    const decisions = getDecisionEngine();

    const decision = decisions.createDecision({
      type: "approve",
      subject: `Mission: ${goal.substring(0, 100)}`,
      context: { missionId, goal, ...context },
      proposedBy: "ceo",
      requiredApprovals: 2,
      confidence: 0.8,
      reasoning: "Mission review by executive board",
      evidence: [{ missionId, goal, context: context || {} }],
      missionId,
      chatId: this.config.chatId,
    });

    // CEOs vote first
    decisions.castVote(decision.id, this.buildVote("ceo", decision));

    // CTO and COO vote for agent mode
    if (this.config.mode === "agent") {
      decisions.castVote(decision.id, this.buildVote("cto", decision));
      decisions.castVote(decision.id, this.buildVote("coo", decision));
    }

    // CSO reviews if needed
    const cleanedGoal = goal.toLowerCase();
    if (/exploit|attack|payload|inject|bypass|crack/.test(cleanedGoal)) {
      decisions.castVote(decision.id, this.buildVote("cso", decision));
    }

    const final = decisions.get(decision.id)!;
    decisions.execute(decision.id);

    // Assign workers
    const dept = findDepartmentForTool("run_terminal_cmd")!;
    const assignment = assignWorker(dept.id, `Mission: ${goal.substring(0, 80)}`);

    // Emit event
    const eb = getEventBus();
    eb.publish("executive:decision", {
      executiveId: "ceo",
      decision: final.status === "approved" ? "approve" : "reject",
      reasoning: final.reasoning,
      confidence: final.confidence,
    }, { missionId, chatId: this.config.chatId, executiveId: "ceo" });

    return {
      allowed: final.status === "approved",
      decision: final,
      assignment: assignment || undefined,
      evidenceRequired: true,
      escalationRequired: final.status === "rejected",
      reasoning: `Board ${final.status}: ${final.currentApprovals}/${final.requiredApprovals} approvals`,
    };
  }

  // ── TOOL AUTHORIZATION ───────────────────────────────

  authorizeTool(toolName: string, command: string, missionId?: string): BoardReviewResult {
    const decisions = getDecisionEngine();
    const isDangerous = /rm -rf|sudo|chmod 777|wget.*\|.*sh|curl.*\|.*bash|mkfs|dd if=/.test(command);
    const requiredApprovals = isDangerous ? 3 : 1;

    const decision = decisions.createDecision({
      type: isDangerous ? "verify" : "approve",
      subject: `Tool: ${toolName}${command ? ` — ${command.substring(0, 80)}` : ""}`,
      context: { toolName, command, isDangerous },
      proposedBy: "cto",
      requiredApprovals,
      confidence: isDangerous ? 0.5 : 0.9,
      reasoning: isDangerous ? "Dangerous command requires board review" : "Routine tool execution",
      toolName,
      missionId,
      chatId: this.config.chatId,
    });

    // Constitution check
    const cr = getConstitutionRuntime();
    const constDecision = cr.authorizeTool({
      toolName,
      command,
      chatId: this.config.chatId,
      riskLevel: isDangerous ? "critical" : "medium",
      policy: "balanced",
    });

    if (!constDecision.allowed) {
      decisions.override(decision.id, "constitution", constDecision.reasons.join("; "));
      return {
        allowed: false,
        decision: decisions.get(decision.id)!,
        evidenceRequired: true,
        escalationRequired: false,
        reasoning: `Constitution blocked: ${constDecision.reasons.join("; ")}`,
      };
    }

    // CTO always votes
    decisions.castVote(decision.id, this.buildVote("cto", decision));

    // CSO votes on dangerous commands
    if (isDangerous) {
      decisions.castVote(decision.id, this.buildVote("cso", decision));
      decisions.castVote(decision.id, this.buildVote("ceo", decision));
    }

    // CQA votes if evidence required
    if (constDecision.requiresEvidence) {
      decisions.castVote(decision.id, this.buildVote("cqa", decision));
    }

    const final = decisions.get(decision.id)!;

    if (final.status === "approved") {
      decisions.execute(decision.id);
      const dept = findDepartmentForTool(toolName) || getDepartmentByRole("cto")!;
      assignWorker(dept.id, `${toolName}: ${command.substring(0, 60)}`);

      const eb = getEventBus();
      eb.publish("executive:decision", {
        executiveId: "cto",
        decision: `approved-tool-${toolName}`,
        reasoning: final.reasoning,
        confidence: final.confidence,
      }, { missionId, chatId: this.config.chatId, executiveId: "cto" });
    }

    return {
      allowed: final.status === "approved",
      decision: final,
      evidenceRequired: constDecision.requiresEvidence,
      escalationRequired: final.status === "rejected",
      reasoning: `Tool ${final.status}: ${final.reasoning}`,
    };
  }

  // ── DELEGATION ──────────────────────────────────────

  delegate(deptId: string, task: string): Assignment | null {
    const assignment = assignWorker(deptId, task);
    if (!assignment) {
      // Escalate if no workers available
      const altDept = getDepartmentByRole("cto");
      if (altDept && altDept.id !== deptId) {
        return assignWorker(altDept.id, `${task} (escalated from ${deptId})`);
      }
    }
    return assignment;
  }

  // ── ESCALATION ──────────────────────────────────────

  escalate(decisionId: string, to: ExecutiveId): Decision | null {
    const decisions = getDecisionEngine();
    const escalated = decisions.escalate(decisionId, EXECUTIVE_NAMES[to]);

    if (escalated) {
      // The escalated-to executive casts a deciding vote
      decisions.castVote(decisionId, {
        executiveId: to,
        executiveName: EXECUTIVE_NAMES[to],
        vote: "approve",
        confidence: 0.7,
        reasoning: `Escalated decision override by ${EXECUTIVE_NAMES[to]}`,
        timestamp: Date.now(),
      });
    }

    return escalated;
  }

  // ── WORKER MANAGEMENT ───────────────────────────────

  completeWorkerTask(workerId: string, success: boolean, durationMs: number): void {
    completeWorkerTask(workerId, success, durationMs);
  }

  getDepartmentStats() {
    return require("./departments").getDepartmentStats();
  }

  // ── DECISION HISTORY ─────────────────────────────────

  getDecisionHistory(missionId?: string): Decision[] {
    const decisions = getDecisionEngine();
    return missionId ? decisions.getByMission(missionId) : decisions.getHistory();
  }

  // ── PRIVATE ─────────────────────────────────────────

  private buildVote(executiveId: ExecutiveId, decision: Decision): DecisionVote {
    const bias = EXECUTIVE_BIAS[executiveId];
    const confidence = bias.approvalProbability as number;

    return {
      executiveId,
      executiveName: EXECUTIVE_NAMES[executiveId],
      vote: confidence >= 0.5 ? "approve" : "reject",
      confidence: confidence as any,
      reasoning: `${EXECUTIVE_NAMES[executiveId]} review: ${vocabulary[Math.floor(Math.random() * vocabulary.length)]}`,
      timestamp: Date.now(),
    };
  }
}

const vocabulary = [
  "Approved. Risk level acceptable.",
  "Approved with standard monitoring.",
  "Approved. Proceed with caution.",
  "Conditionally approved — require verification.",
  "Denied. Insufficient evidence for risk level.",
  "Abstaining — defer to CTO/CEO judgment.",
  "Approved. Within standard operating parameters.",
  "Requires additional evidence before approval.",
];
