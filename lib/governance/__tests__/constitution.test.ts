// @module governance/__tests__/constitution.test.ts v1.0.0

import { getConstitutionRuntime, resetConstitutionRuntime } from "../runtime";
import { evaluatePolicy, evaluateCondition } from "../rule-engine";
import { CONSTITUTION, getAllRules, getEnabledRules } from "../constitution";
import { validateMission, authorizeTool, authorizeExecutive } from "../policy-engine";
import { recordAuditEntry, queryAuditTrail } from "../audit-trail";

let cr: ReturnType<typeof getConstitutionRuntime>;

beforeEach(() => {
  resetConstitutionRuntime();
  cr = getConstitutionRuntime({ auditAll: true, logDecisions: false, notifyOnDeny: false });
});

describe("Constitution Runtime", () => {
  test("loads constitution with all articles", () => {
    const articles = cr.getArticles();
    expect(articles.length).toBe(12);
    expect(articles[0].title).toBe("Architecture Supremacy");
    expect(articles[11].title).toBe("The Golden Rule");
  });

  test("all rules are registered", () => {
    const all = cr.getAllRules();
    expect(all.length).toBeGreaterThan(30);
  });

  test("enabled rules are active", () => {
    const enabled = cr.getEnabledRules();
    expect(enabled.length).toBe(cr.getAllRules().length); // All enabled by default
  });

  test("version and status returned", () => {
    const status = cr.getStatus();
    expect(status.version).toBe("1.0.0");
    expect(status.articles).toBe(12);
    expect(status.totalRules).toBeGreaterThan(30);
    expect(status.autoEnforce).toBe(true);
  });
});

describe("Rule Engine", () => {
  test("allow action passes", () => {
    const decision = cr.evaluate({ action: "test_action" });
    // No rules match "test_action", so it's allowed by default
    expect(decision.allowed).toBe(true);
  });

  test("deny blocks cross-layer import", () => {
    const decision = cr.evaluate({ action: "cross_layer_import" });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingRules).toContain("C1.2");
  });

  test("require_evidence for AI changes", () => {
    const decision = cr.evaluate({ action: "ai_change" });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresEvidence).toBe(true);
  });

  test("require_approval for architecture changes", () => {
    const decision = cr.evaluate({ action: "architecture_change" });
    expect(decision.requiresApproval).toBe(true);
  });

  test("require_verification for merge", () => {
    const decision = cr.evaluate({ action: "merge" });
    expect(decision.requiresVerification).toBe(true);
  });

  test("security veto blocks", () => {
    const decision = cr.evaluate({ action: "some_action", security_veto: true });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingRules).toContain("C4.1");
  });

  test("HIGH finding blocks merge", () => {
    const decision = cr.evaluate({ action: "merge", finding_severity: "HIGH" });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingRules).toContain("C2.4");
  });

  test("CRITICAL finding blocks merge", () => {
    const decision = cr.evaluate({ action: "merge", finding_severity: "CRITICAL" });
    expect(decision.allowed).toBe(false);
  });

  test("MEDIUM finding does not block merge", () => {
    const decision = cr.evaluate({ action: "merge", finding_severity: "MEDIUM" });
    expect(decision.allowed).toBe(true);
  });

  test("performance regression > 10% blocks", () => {
    const decision = cr.evaluate({ action: "performance_regression", regression_pct: 25 });
    expect(decision.allowed).toBe(false);
  });

  test("performance regression <= 10% does not block", () => {
    const decision = cr.evaluate({ action: "performance_regression", regression_pct: 5 });
    expect(decision.allowed).toBe(true);
  });
});

describe("Condition Evaluation", () => {
  test("equals operator", () => {
    const result = evaluateCondition(
      { field: "action", operator: "equals", value: "merge" },
      { action: "merge" },
    );
    expect(result.matched).toBe(true);
  });

  test("not_equals operator", () => {
    const result = evaluateCondition(
      { field: "action", operator: "not_equals", value: "delete" },
      { action: "merge" },
    );
    expect(result.matched).toBe(true);
  });

  test("contains operator", () => {
    const result = evaluateCondition(
      { field: "message", operator: "contains", value: "error" },
      { message: "an error occurred" },
    );
    expect(result.matched).toBe(true);
  });

  test("gt operator", () => {
    const result = evaluateCondition(
      { field: "count", operator: "gt", value: 10 },
      { count: 15 },
    );
    expect(result.matched).toBe(true);
  });

  test("lt operator", () => {
    const result = evaluateCondition(
      { field: "count", operator: "lt", value: 100 },
      { count: 50 },
    );
    expect(result.matched).toBe(true);
  });

  test("in operator", () => {
    const result = evaluateCondition(
      { field: "severity", operator: "in", value: ["HIGH", "CRITICAL"] },
      { severity: "HIGH" },
    );
    expect(result.matched).toBe(true);
  });

  test("in operator — negative", () => {
    const result = evaluateCondition(
      { field: "severity", operator: "in", value: ["HIGH", "CRITICAL"] },
      { severity: "MEDIUM" },
    );
    expect(result.matched).toBe(false);
  });

  test("exists operator", () => {
    const result = evaluateCondition(
      { field: "security_veto", operator: "exists" },
      { security_veto: true },
    );
    expect(result.matched).toBe(true);
  });

  test("not_exists operator", () => {
    const result = evaluateCondition(
      { field: "missing", operator: "not_exists" },
      {},
    );
    expect(result.matched).toBe(true);
  });

  test("matches operator", () => {
    const result = evaluateCondition(
      { field: "email", operator: "matches", value: "^test@" },
      { email: "test@example.com" },
    );
    expect(result.matched).toBe(true);
  });

  test("nested field path", () => {
    const result = evaluateCondition(
      { field: "meta.severity", operator: "equals", value: "HIGH" },
      { meta: { severity: "HIGH" } },
    );
    expect(result.matched).toBe(true);
  });
});

describe("Policy Engine", () => {
  test("validate mission allows balanced policy", () => {
    const decision = validateMission({
      missionId: "m1", goal: "Build API", policy: "balanced",
      estimatedTools: ["file_read", "bash"], estimatedTokens: 2000, estimatedDurationMs: 60000,
    });
    expect(decision.allowed).toBe(true);
  });

  test("tool authorization allows low-risk tools", () => {
    const decision = authorizeTool({
      toolName: "file_read", riskLevel: "low", policy: "safe",
    });
    expect(decision.allowed).toBe(true);
  });

  test("tool authorization flags dangerous commands", () => {
    const decision = authorizeTool({
      toolName: "run_terminal_cmd", command: "rm -rf /tmp/test",
      riskLevel: "critical", policy: "safe",
    });
    expect(decision.requiresHumanReview).toBe(true);
  });

  test("executive low confidence requires approval", () => {
    const decision = authorizeExecutive({
      executiveId: "cto", executiveName: "CTO",
      decision: "risky-decision", confidence: 0.4,
    });
    expect(decision.requiresApproval).toBe(true);
  });

  test("executive very low confidence is denied", () => {
    const decision = authorizeExecutive({
      executiveId: "cto", executiveName: "CTO",
      decision: "bad-decision", confidence: 0.2,
    });
    expect(decision.allowed).toBe(false);
  });

  test("executive high confidence is allowed", () => {
    const decision = authorizeExecutive({
      executiveId: "cto", executiveName: "CTO",
      decision: "routine-decision", confidence: 0.95,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("Audit Trail", () => {
  test("record and query audit entries", () => {
    recordAuditEntry({
      action: "test_action",
      decision: "allow",
      reason: "Test audit entry",
      context: { test: true },
      outcome: "allowed",
    });

    const results = queryAuditTrail({ action: "test_action" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].action).toBe("test_action");
    expect(results[0].decision).toBe("allow");
  });

  test("policy decision generates audit entries", () => {
    const decision = cr.evaluate({ action: "cross_layer_import" });
    expect(decision.allowed).toBe(false);

    const results = queryAuditTrail({ action: "cross_layer_import" });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
