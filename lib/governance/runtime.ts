// @module governance/runtime v1.0.0 — Constitution Runtime Engine

import { CONSTITUTION, type Constitution, type ConstitutionRule } from "./constitution";
import { evaluatePolicy, type RuleEvaluationContext, type PolicyDecision, type RuleEvaluationResult } from "./rule-engine";
import {
  validateMission,
  authorizeTool,
  authorizeRecovery,
  authorizeExecutive,
  evaluateWorkspacePolicy,
  type MissionValidationInput,
  type ToolAuthorizationInput,
  type RecoveryAuthorizationInput,
  type ExecutiveAuthorizationInput,
  type WorkspacePolicyInput,
} from "./policy-engine";
import { recordPolicyDecision, queryAuditTrail, getAuditCount, type AuditEntry } from "./audit-trail";
import { getEventBus } from "@/lib/events";

export interface ConstitutionRuntimeConfig {
  autoEnforce: boolean;
  auditAll: boolean;
  logDecisions: boolean;
  notifyOnDeny: boolean;
}

const DEFAULT_CONFIG: ConstitutionRuntimeConfig = {
  autoEnforce: true,
  auditAll: true,
  logDecisions: true,
  notifyOnDeny: true,
};

class ConstitutionRuntime {
  private constitution: Constitution;
  private config: ConstitutionRuntimeConfig;
  private initialized: boolean = false;

  constructor(config: Partial<ConstitutionRuntimeConfig> = {}) {
    this.constitution = CONSTITUTION;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    console.info(`[CONSTITUTION] runtime initialized v${this.constitution.version} articles=${this.constitution.articles.length} rules=${this.getAllRules().length}`);
  }

  // ── Core API ─────────────────────────────────────────

  getVersion(): string {
    return this.constitution.version;
  }

  getArticles(): { number: number; title: string; ruleCount: number }[] {
    return this.constitution.articles.map(a => ({
      number: a.number,
      title: a.title,
      ruleCount: a.rules.length,
    }));
  }

  getAllRules(): ConstitutionRule[] {
    return this.constitution.articles.flatMap(a => a.rules);
  }

  getEnabledRules(): ConstitutionRule[] {
    return this.getAllRules().filter(r => r.enabled);
  }

  // ── Evaluation ───────────────────────────────────────

  evaluate(context: RuleEvaluationContext): PolicyDecision {
    const decision = evaluatePolicy(context);

    if (this.config.logDecisions) {
      const matchedRules = decision.results.filter(r => r.matched);
      if (matchedRules.length > 0) {
        console.info(`[CONSTITUTION] evaluated action=${context.action} allowed=${decision.allowed} rules=${matchedRules.map(r => r.ruleId).join(",")}`);
      }
    }

    if (this.config.auditAll && decision.results.length > 0) {
      recordPolicyDecision(context.action as string, decision, context as Record<string, unknown>);
    }

    if (this.config.notifyOnDeny && !decision.allowed && decision.blockingRules.length > 0) {
      const eb = getEventBus();
      eb.publish("system:error", {
        error: `Constitution violation: ${decision.blockingRules.join(", ")}`,
        component: "constitution-runtime",
        severity: "major",
      });
    }

    return decision;
  }

  // ── Domain-Specific Validation ───────────────────────

  validateMission(input: MissionValidationInput): PolicyDecision {
    const decision = validateMission(input);

    if (this.config.logDecisions) {
      console.info(`[CONSTITUTION] mission=${input.missionId} allowed=${decision.allowed} policy=${input.policy}`);
    }

    if (this.config.auditAll) {
      recordPolicyDecision("mission_validation", decision, input as unknown as Record<string, unknown>, {
        missionId: input.missionId,
        userId: input.userId,
      });
    }

    if (this.config.notifyOnDeny && !decision.allowed) {
      getEventBus().publish("mission:failed", {
        missionId: input.missionId,
        error: "Constitution denied mission",
        phase: "validation",
      }, { missionId: input.missionId });
    }

    return decision;
  }

  authorizeTool(input: ToolAuthorizationInput): PolicyDecision {
    const decision = authorizeTool(input);

    if (this.config.logDecisions) {
      console.info(`[CONSTITUTION] tool=${input.toolName} allowed=${decision.allowed} risk=${input.riskLevel}`);
    }

    if (this.config.auditAll) {
      recordPolicyDecision("tool_authorization", decision, input as unknown as Record<string, unknown>, {
        missionId: input.missionId,
        chatId: input.chatId,
        toolName: input.toolName,
      });
    }

    if (this.config.notifyOnDeny && !decision.allowed) {
      getEventBus().publish("tool:failed", {
        toolName: input.toolName,
        toolCallId: "",
        error: "Constitution denied tool execution",
        retryCount: 0,
      }, { chatId: input.chatId });
    }

    return decision;
  }

  authorizeRecovery(input: RecoveryAuthorizationInput): PolicyDecision {
    const decision = authorizeRecovery(input);

    if (this.config.auditAll) {
      recordPolicyDecision("recovery_authorization", decision, input as unknown as Record<string, unknown>, {
        missionId: input.missionId,
        chatId: input.chatId,
      });
    }

    return decision;
  }

  authorizeExecutive(input: ExecutiveAuthorizationInput): PolicyDecision {
    const decision = authorizeExecutive(input);

    if (this.config.logDecisions) {
      console.info(`[CONSTITUTION] exec=${input.executiveName} allowed=${decision.allowed} confidence=${input.confidence}`);
    }

    if (this.config.auditAll) {
      recordPolicyDecision("executive_authorization", decision, input as unknown as Record<string, unknown>, {
        missionId: input.missionId,
        chatId: input.chatId,
        executiveId: input.executiveId,
      });
    }

    return decision;
  }

  evaluateWorkspace(input: WorkspacePolicyInput): PolicyDecision {
    const decision = evaluateWorkspacePolicy(input);

    if (this.config.auditAll) {
      recordPolicyDecision("workspace_policy", decision, input as unknown as Record<string, unknown>);
    }

    return decision;
  }

  // ── Audit ────────────────────────────────────────────

  getAuditTrail(filter: Parameters<typeof queryAuditTrail>[0] = {}): AuditEntry[] {
    return queryAuditTrail(filter);
  }

  getAuditCount(action?: string): number {
    return getAuditCount(action);
  }

  // ── Configuration ────────────────────────────────────

  getConfig(): ConstitutionRuntimeConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ConstitutionRuntimeConfig>): void {
    this.config = { ...this.config, ...updates };
    console.info(`[CONSTITUTION] config updated ${JSON.stringify(updates)}`);
  }

  // ── Status ───────────────────────────────────────────

  getStatus(): {
    version: string;
    articles: number;
    totalRules: number;
    enabledRules: number;
    autoEnforce: boolean;
    auditCount: number;
  } {
    return {
      version: this.constitution.version,
      articles: this.constitution.articles.length,
      totalRules: this.getAllRules().length,
      enabledRules: this.getEnabledRules().length,
      autoEnforce: this.config.autoEnforce,
      auditCount: getAuditCount(),
    };
  }
}

let runtimeInstance: ConstitutionRuntime | null = null;

export function getConstitutionRuntime(config?: Partial<ConstitutionRuntimeConfig>): ConstitutionRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new ConstitutionRuntime(config);
    runtimeInstance.init();
  }
  return runtimeInstance;
}

export function resetConstitutionRuntime(): void {
  runtimeInstance = null;
}
