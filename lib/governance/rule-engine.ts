// @module governance/rule-engine v1.0.0 — Constitution Rule Evaluation Engine

import type { ConstitutionRule, RuleCondition, RuleEffect } from "./constitution";
import { getEnabledRules } from "./constitution";

export interface RuleEvaluationContext {
  action: string;
  subject?: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuleEvaluationResult {
  ruleId: string;
  article: string;
  matched: boolean;
  effect: RuleEffect;
  reason: string;
  conditions: {
    field: string;
    matched: boolean;
    expected: unknown;
    actual: unknown;
  }[];
}

export interface PolicyDecision {
  allowed: boolean;
  effect: RuleEffect;
  reasons: string[];
  requiresEvidence: boolean;
  requiresApproval: boolean;
  requiresVerification: boolean;
  requiresAudit: boolean;
  requiresHumanReview: boolean;
  blockingRules: string[];
  results: RuleEvaluationResult[];
}

export function evaluateRules(context: RuleEvaluationContext): RuleEvaluationResult[] {
  const rules = getEnabledRules();
  const results: RuleEvaluationResult[] = [];

  for (const rule of rules) {
    const conditionResults = rule.conditions.map(c => evaluateCondition(c, context));
    const allMatched = conditionResults.every(c => c.matched);

    results.push({
      ruleId: rule.id,
      article: rule.article,
      matched: allMatched,
      effect: allMatched ? rule.effect : "allow",
      reason: allMatched
        ? `Rule ${rule.id}: ${rule.description}`
        : `Rule ${rule.id}: conditions not met (${conditionResults.filter(c => !c.matched).map(c => c.field).join(", ")})`,
      conditions: conditionResults,
    });
  }

  return results;
}

export function evaluatePolicy(context: RuleEvaluationContext): PolicyDecision {
  const results = evaluateRules(context);
  const matched = results.filter(r => r.matched);

  const effects = matched.map(r => r.effect);
  const hasDeny = effects.includes("deny");
  const blockingRules = matched.filter(r => r.effect === "deny").map(r => r.ruleId);

  return {
    allowed: !hasDeny,
    effect: hasDeny ? "deny" : "allow",
    reasons: matched.map(r => r.reason),
    requiresEvidence: effects.includes("require_evidence"),
    requiresApproval: effects.includes("require_approval"),
    requiresVerification: effects.includes("require_verification"),
    requiresAudit: effects.includes("require_audit"),
    requiresHumanReview: effects.includes("require_human_review"),
    blockingRules,
    results,
  };
}

export function evaluateCondition(
  condition: RuleCondition,
  context: RuleEvaluationContext,
): { matched: boolean; field: string; expected: unknown; actual: unknown } {
  const value = getNestedValue(context, condition.field);
  const expected = condition.value;

  let matched = false;
  switch (condition.operator) {
    case "equals":
      matched = value === expected;
      break;
    case "not_equals":
      matched = value !== expected;
      break;
    case "contains":
      matched = typeof value === "string" && typeof expected === "string" && value.includes(expected);
      break;
    case "not_contains":
      matched = typeof value === "string" && typeof expected === "string" && !value.includes(expected);
      break;
    case "matches":
      matched = typeof value === "string" && typeof expected === "string" && new RegExp(expected).test(value);
      break;
    case "gt":
      matched = Number(value) > Number(expected);
      break;
    case "lt":
      matched = Number(value) < Number(expected);
      break;
    case "gte":
      matched = Number(value) >= Number(expected);
      break;
    case "lte":
      matched = Number(value) <= Number(expected);
      break;
    case "in":
      matched = Array.isArray(expected) && expected.includes(value);
      break;
    case "not_in":
      matched = Array.isArray(expected) && !expected.includes(value);
      break;
    case "exists":
      matched = value !== undefined && value !== null;
      break;
    case "not_exists":
      matched = value === undefined || value === null;
      break;
    default:
      matched = false;
  }

  return { matched, field: condition.field, expected, actual: value };
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
