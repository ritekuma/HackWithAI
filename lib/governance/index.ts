// @module governance v1.0.0 — Constitution Runtime public API

export { getConstitutionRuntime, resetConstitutionRuntime } from "./runtime";
export type { ConstitutionRuntimeConfig } from "./runtime";

export { CONSTITUTION } from "./constitution";
export type {
  Constitution,
  ConstitutionArticle,
  ConstitutionRule,
  RuleEffect,
  RuleSeverity,
  RuleCondition,
} from "./constitution";
export { getRulesByArticle, getRuleById, getAllRules, getEnabledRules } from "./constitution";

export { evaluateRules, evaluatePolicy, evaluateCondition, getNestedValue } from "./rule-engine";
export type {
  RuleEvaluationContext,
  RuleEvaluationResult,
  PolicyDecision,
} from "./rule-engine";

export {
  validateMission,
  authorizeTool,
  authorizeRecovery,
  authorizeExecutive,
  evaluateWorkspacePolicy,
} from "./policy-engine";
export type {
  MissionValidationInput,
  ToolAuthorizationInput,
  RecoveryAuthorizationInput,
  ExecutiveAuthorizationInput,
  WorkspacePolicyInput,
} from "./policy-engine";

export { recordAuditEntry, recordPolicyDecision, queryAuditTrail, getAuditCount } from "./audit-trail";
export type { AuditEntry } from "./audit-trail";
