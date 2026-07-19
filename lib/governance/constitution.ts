// @module governance/constitution v1.0.0 — Executable Constitution definition

export type RuleEffect = "allow" | "deny" | "require_evidence" | "require_approval" | "require_verification" | "require_audit" | "require_human_review";

export type RuleSeverity = "critical" | "major" | "minor" | "advisory";

export interface ConstitutionRule {
  id: string;
  article: string;
  description: string;
  effect: RuleEffect;
  severity: RuleSeverity;
  conditions: RuleCondition[];
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface RuleCondition {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "matches" | "gt" | "lt" | "gte" | "lte" | "in" | "not_in" | "exists" | "not_exists";
  value?: unknown;
}

export interface ConstitutionArticle {
  number: number;
  title: string;
  text: string;
  rules: ConstitutionRule[];
}

export interface Constitution {
  version: string;
  title: string;
  effectiveDate: string;
  articles: ConstitutionArticle[];
}

export const CONSTITUTION: Constitution = {
  version: "1.0.0",
  title: "HackWithAI Engineering Constitution",
  effectiveDate: "2026-07-19",
  articles: [
    {
      number: 1,
      title: "Architecture Supremacy",
      text: "The Architecture Freeze is inviolable. No implementation may violate phase boundaries, layer rules, or module organization.",
      rules: [
        {
          id: "C1.1",
          article: "I",
          description: "No architecture changes without formal process",
          effect: "require_approval",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "architecture_change" },
          ],
          enabled: true,
        },
        {
          id: "C1.2",
          article: "I",
          description: "Layer violations are blocked",
          effect: "deny",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "cross_layer_import" },
          ],
          enabled: true,
        },
        {
          id: "C1.3",
          article: "I",
          description: "Module organization must match architecture spec",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "new_module" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 2,
      title: "Quality Is Non-Negotiable",
      text: "Every change shall be validated before merge. AI evaluation gates are P0 for all AI-related changes.",
      rules: [
        {
          id: "C2.1",
          article: "II",
          description: "P0 quality gates must pass before merge",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "merge" },
          ],
          enabled: true,
        },
        {
          id: "C2.2",
          article: "II",
          description: "AI evaluation gates required for AI-related changes",
          effect: "require_evidence",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "ai_change" },
          ],
          enabled: true,
        },
        {
          id: "C2.3",
          article: "II",
          description: "Test coverage shall increase monotonically",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "coverage_check" },
          ],
          enabled: true,
        },
        {
          id: "C2.4",
          article: "II",
          description: "Security HIGH/CRITICAL findings block merge",
          effect: "deny",
          severity: "critical",
          conditions: [
            { field: "finding_severity", operator: "in", value: ["HIGH", "CRITICAL"] },
          ],
          enabled: true,
        },
        {
          id: "C2.5",
          article: "II",
          description: "Performance regression >10% blocks merge",
          effect: "deny",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "performance_regression" },
            { field: "regression_pct", operator: "gt", value: 10 },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 3,
      title: "The SDLC Is Mandatory",
      text: "Every sprint shall follow the Enterprise SDLC. No phase may be skipped.",
      rules: [
        {
          id: "C3.1",
          article: "III",
          description: "All required phases must be completed",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "sprint_completion" },
          ],
          enabled: true,
        },
        {
          id: "C3.2",
          article: "III",
          description: "Discovery and Impact Analysis are prerequisites for implementation",
          effect: "require_evidence",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "start_implementation" },
          ],
          enabled: true,
        },
        {
          id: "C3.3",
          article: "III",
          description: "Testing, Review, and Evaluation are merge prerequisites",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "merge" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 4,
      title: "Roles and Accountability",
      text: "Engineering roles are defined and accountable. Every decision has exactly one accountable role.",
      rules: [
        {
          id: "C4.1",
          article: "IV",
          description: "Security Engineer's veto on HIGH/CRITICAL findings is absolute",
          effect: "deny",
          severity: "critical",
          conditions: [
            { field: "security_veto", operator: "equals", value: true },
          ],
          enabled: true,
        },
        {
          id: "C4.2",
          article: "IV",
          description: "No single person may hold all approval authorities",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "approval" },
          ],
          enabled: true,
          config: { min_approvers: 2 },
        },
        {
          id: "C4.3",
          article: "IV",
          description: "Review responsibilities shall be discharged within defined timelines",
          effect: "require_audit",
          severity: "minor",
          conditions: [
            { field: "action", operator: "equals", value: "review_overdue" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 5,
      title: "Observability First",
      text: "No code without observability. Every function, module, or service shall emit telemetry.",
      rules: [
        {
          id: "C5.1",
          article: "V",
          description: "All new code must have metrics (count, latency, success)",
          effect: "require_evidence",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "new_code" },
          ],
          enabled: true,
        },
        {
          id: "C5.2",
          article: "V",
          description: "All async operations spanning module boundaries require tracing",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "cross_module_async" },
          ],
          enabled: true,
        },
        {
          id: "C5.3",
          article: "V",
          description: "Health checks must exist for every subsystem",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "new_subsystem" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 6,
      title: "Feature Flags",
      text: "All new features shall be behind feature flags with kill switches.",
      rules: [
        {
          id: "C6.1",
          article: "VI",
          description: "New functionality must be feature-flagged",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "new_feature" },
          ],
          enabled: true,
        },
        {
          id: "C6.2",
          article: "VI",
          description: "Every feature flag must have a kill switch",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "feature_flag_created" },
          ],
          enabled: true,
        },
        {
          id: "C6.3",
          article: "VI",
          description: "Feature flags must be removed within 2 sprints of GA",
          effect: "require_audit",
          severity: "minor",
          conditions: [
            { field: "action", operator: "equals", value: "flag_expired" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 7,
      title: "Backward Compatibility",
      text: "Breaking changes require explicit approval and migration.",
      rules: [
        {
          id: "C7.1",
          article: "VII",
          description: "Breaking API changes require documented migration path",
          effect: "require_evidence",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "breaking_api_change" },
          ],
          enabled: true,
        },
        {
          id: "C7.2",
          article: "VII",
          description: "Database migrations must be backward-compatible for one version",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "db_migration" },
          ],
          enabled: true,
        },
        {
          id: "C7.3",
          article: "VII",
          description: "System prompt changes must be regression-tested",
          effect: "require_evidence",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "prompt_change" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 8,
      title: "Incident Response",
      text: "Incidents shall be managed with urgency and rigor.",
      rules: [
        {
          id: "C8.1",
          article: "VIII",
          description: "Every incident must be assigned severity within 5 minutes",
          effect: "require_audit",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "incident_detected" },
          ],
          enabled: true,
        },
        {
          id: "C8.2",
          article: "VIII",
          description: "SEV-0 and SEV-1 incidents require postmortem within 48 hours",
          effect: "require_evidence",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "incident_resolved" },
            { field: "severity", operator: "in", value: ["SEV-0", "SEV-1"] },
          ],
          enabled: true,
        },
        {
          id: "C8.3",
          article: "VIII",
          description: "Postmortems shall be blameless and focus on systemic improvement",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "postmortem_submitted" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 9,
      title: "Knowledge Preservation",
      text: "Learning shall be codified and preserved.",
      rules: [
        {
          id: "C9.1",
          article: "IX",
          description: "Architecture decisions must be documented in ADRs",
          effect: "require_evidence",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "architecture_decision" },
          ],
          enabled: true,
        },
        {
          id: "C9.2",
          article: "IX",
          description: "Baselines must be updated after every release",
          effect: "require_verification",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "release" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 10,
      title: "Continuous Improvement",
      text: "The organization shall continuously improve its processes.",
      rules: [
        {
          id: "C10.1",
          article: "X",
          description: "Engineering metrics shall be reviewed at sprint end",
          effect: "require_audit",
          severity: "minor",
          conditions: [
            { field: "action", operator: "equals", value: "sprint_end" },
          ],
          enabled: true,
        },
        {
          id: "C10.2",
          article: "X",
          description: "Constitution shall be amended through formal proposals only",
          effect: "require_approval",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "constitution_amendment" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 11,
      title: "The Merge Gate",
      text: "No code shall pass to main unless the gates are green.",
      rules: [
        {
          id: "C11.1",
          article: "XI",
          description: "All P0 gates must pass",
          effect: "require_verification",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "merge" },
          ],
          enabled: true,
        },
        {
          id: "C11.2",
          article: "XI",
          description: "P1 gates must pass or have documented exceptions",
          effect: "require_evidence",
          severity: "major",
          conditions: [
            { field: "action", operator: "equals", value: "merge" },
          ],
          enabled: true,
        },
      ],
    },
    {
      number: 12,
      title: "The Golden Rule",
      text: "Do not degrade what works. Every change shall be validated against the baseline.",
      rules: [
        {
          id: "C12.1",
          article: "XII",
          description: "All changes must be validated against baseline",
          effect: "require_evidence",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "code_change" },
          ],
          enabled: true,
        },
        {
          id: "C12.2",
          article: "XII",
          description: "Regression is unacceptable without explicit justification",
          effect: "require_approval",
          severity: "critical",
          conditions: [
            { field: "action", operator: "equals", value: "regression_accepted" },
          ],
          enabled: true,
        },
        {
          id: "C12.3",
          article: "XII",
          description: "When in doubt, maintain status quo",
          effect: "deny",
          severity: "advisory",
          conditions: [
            { field: "action", operator: "equals", value: "uncertain_change" },
          ],
          enabled: true,
        },
      ],
    },
  ],
};

export function getRulesByArticle(articleNumber: number): ConstitutionRule[] {
  const article = CONSTITUTION.articles.find(a => a.number === articleNumber);
  return article?.rules || [];
}

export function getRuleById(id: string): ConstitutionRule | undefined {
  for (const article of CONSTITUTION.articles) {
    const rule = article.rules.find(r => r.id === id);
    if (rule) return rule;
  }
  return undefined;
}

export function getAllRules(): ConstitutionRule[] {
  return CONSTITUTION.articles.flatMap(a => a.rules);
}

export function getEnabledRules(): ConstitutionRule[] {
  return getAllRules().filter(r => r.enabled);
}
