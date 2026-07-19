# AI Evaluation Platform — Architecture Specification

**Sprint:** -0.8 
**Status:** DESIGN COMPLETE — No Implementation
**Lines:** 635 design specification

---

## 1. AUDIT — Current Evaluation Capabilities

### 1.1 What Exists

| Capability | Status | Details |
|---|---|---|
| **Unit Tests** | 123 files | Auth, billing, utility tests. 0 tests for chat-handler, executive-kernel, context-builder, memory, mission, tools |
| **E2E Tests** | 5 files | Playwright. Basic app smoke tests. No AI-specific E2E |
| **Coverage** | 0% threshold | Thresholds set to 0 in jest.config.js |
| **Observability Engine** | 397 lines | `lib/observability/engine.ts` — MetricsRegistry (Prometheus), Tracer, CostTracker, HealthChecks, Dashboard data |
| **Chat Logger** | 800+ lines | `lib/api/chat-logger.ts` — wide-event pattern. Tracks tokens, cost, latency, tools, model. PostHog integration |
| **Metrics Endpoint** | `GET /api/metrics` | Prometheus text + JSON snapshot |
| **Ops Dashboard** | `GET /api/ops` | Execution dashboard (jobs, workers, cost) |
| **Health Check** | `GET /api/health` | sqlite, runtime, openrouter, redis status |
| **Debug Dumps** | 397 files | 231 model-message + 166 payload JSON dumps in `data/debug/` |
| **CI Pipeline** | `.github/workflows/test.yml` | Typecheck + test:ci. No eval gates |
| **Feature Flags** | `lib/auth/feature-flags.ts` | User-percentile hashing. Only CROSS_TAB_TOKEN_SHARING flag |
| **Tool Tracking** | Chat logger | Tool name + count per request. No success/failure/retry metrics |
| **Mission Metrics** | `GET /api/missions/metrics` | Basic engine metrics |
| **Agent Metrics** | `GET /api/agents` | `getMetrics()` per agent |

### 1.2 What is Missing (Complete Gap)

| Capability | Gap |
|---|---|
| **Golden Datasets** | 0 datasets. No reference conversations, missions, tool calls |
| **Prompt Regression** | 0 tests. No way to detect prompt degradation |
| **Model Comparison** | 0 benchmarks. No model-vs-model scoring |
| **Tool Evaluation** | 0 automation. Tool outcomes tracked but never evaluated |
| **Memory Evaluation** | 0 tests. No recall/precision/conflict measurement |
| **Reasoning Evaluation** | 0 tests. No hallucination detection |
| **Recovery Evaluation** | 0 tests. No chaos injection |
| **Long Session Evaluation** | 0 tests. No 100+/500+/1000+ turn testing |
| **Performance Benchmarks** | 0 benchmarks. No startup/latency/throughput baselines |
| **Evaluation Dashboard** | 0 dashboards. No eval-specific UI |
| **Quality Gates** | 0 gates. CI runs typecheck + tests but nothing blocks merge on AI quality |
| **Telemetry** | PARTIAL. Observability engine exists but unused by eval pipeline |

### 1.3 Bootstrap Assets

- **397 debug dumps** → Can seed initial Golden Conversations
- **Observability engine** → Telemetry foundation (MetricsRegistry, Tracer, CostTracker)
- **Chat logger** → Token/cost/latency data source
- **Health check** → Chaos injection target
- **Existing test framework** → Jest + Playwright reconfigured for AI eval
- **Feature flags** → Extend for eval toggling

---

## 2. AI Evaluation Framework — Module Architecture

### 2.1 Directory Structure

```
lib/eval/
├── index.ts                   # Public exports
├── runner.ts                  # EvaluationRunner — orchestrates all suites
├── reporter.ts                # ScoreReporter — JSON, HTML, Markdown, CI annotations
├── types.ts                   # Shared eval types (Score, Result, Report, Suite)
├── database.ts                # EvalDB — SQLite store for historical results
│
├── datasets/
│   ├── index.ts               # DatasetRegistry
│   ├── types.ts               # GoldenCase, GoldenConversation, GoldenMission, etc.
│   ├── conversations/         # Golden conversations
│   │   ├── simple-qa.ts       # Basic Q&A expected responses
│   │   ├── tool-usage.ts      # Expected tool selection patterns
│   │   ├── vision.ts          # Image understanding
│   │   └── multi-step.ts      # Multi-turn agent interactions
│   ├── missions/              # Golden missions
│   │   ├── coding.ts          # Code generation tasks
│   │   ├── debugging.ts       # Bug-fix scenarios
│   │   ├── planning.ts        # Multi-step planning
│   │   └── security.ts        # Security/vulnerability tasks
│   ├── tools/                 # Golden tool calls
│   │   ├── bash.ts            # Shell command correctness
│   │   ├── browser.ts         # Browser interaction
│   │   ├── file-ops.ts        # File read/write/edit
│   │   └── memory.ts          # Memory read/write/search
│   ├── memory/                # Golden memory cases
│   │   ├── recall.ts          # Memory retrieval accuracy
│   │   ├── injection.ts       # Memory injection precision
│   │   ├── conflict.ts        # Conflict resolution
│   │   └── dedup.ts           # Duplicate detection
│   ├── recovery/              # Golden recovery cases
│   │   ├── pty-death.ts       # PTY killed mid-operation
│   │   ├── browser-crash.ts   # Playwright crash recovery
│   │   ├── api-failure.ts     # OpenRouter 5xx handling
│   │   └── context-loss.ts    # Session disconnect recovery
│   ├── workspace/             # Golden workspace cases
│   │   ├── file-creation.ts   # Create files via shell
│   │   ├── git-ops.ts         # Git operations
│   │   └── env-management.ts  # Environment variable management
│   └── security/              # Golden security cases
│       ├── injection.ts       # Prompt injection resistance
│       ├── path-traversal.ts  # Path traversal prevention
│       └── auth-bypass.ts     # Auth bypass attempts
│
├── regression/
│   ├── index.ts               # RegressionSuite
│   ├── runner.ts              # RegressionRunner — run deltas against baseline
│   ├── baseline-store.ts      # Baseline storage/versioning
│   ├── comparators.ts         # CompareOutputs, CompareTokens, CompareLatency, etc.
│   └── detectors.ts           # DegradationDetectors — reasoning, hallucination, tool, etc.
│
├── tool-evaluator/
│   ├── index.ts               # ToolEvaluator
│   ├── correctness.ts         # Tool selection correctness
│   ├── recovery.ts            # Tool recovery behavior
│   └── evidence.ts            # Evidence quality evaluation
│
├── memory-evaluator/
│   ├── index.ts               # MemoryEvaluator
│   ├── recall.ts              # Recall accuracy
│   ├── precision.ts           # Precision measurement
│   └── conflict.ts            # Conflict detection
│
├── executive-evaluator/
│   ├── index.ts               # ExecutiveEvaluator
│   ├── planning.ts            # Planning quality
│   ├── delegation.ts          # Task delegation accuracy
│   └── verification.ts        # Verification quality
│
├── model-benchmark/
│   ├── index.ts               # ModelBenchmark
│   ├── runner.ts              # BenchmarkRunner — run all models against golden sets
│   ├── scoring.ts             # Scorecard generation
│   └── ranking.ts             # Model ranking algorithms
│
├── chaos/
│   ├── index.ts               # ChaosSuite
│   ├── injectors.ts           # Fault injectors (kill PTY, Redis, DB, etc.)
│   └── recovery-validators.ts # Recovery outcome validators
│
├── long-session/
│   ├── index.ts               # LongSessionSuite
│   ├── generator.ts           # Multi-turn conversation generator
│   └── stability.ts           # Stability metrics over turns
│
├── performance/
│   ├── index.ts               # PerformanceSuite
│   ├── benchmarks.ts          # Benchmark scenarios
│   └── profiler.ts            # CPU/RAM/Disk profiling
│
├── telemetry/
│   ├── index.ts               # EvalTelemetry — extends observability engine
│   ├── collectors.ts          # Metric collectors for each eval suite
│   └── aggregators.ts         # Time-series aggregation
│
├── dashboard/
│   ├── index.ts               # EvalDashboard data provider
│   ├── routes.ts              # API routes (eval API endpoints)
│   └── components/            # React components (optional, future)
│
└── gates/
    ├── index.ts               # QualityGateRunner
    ├── criteria.ts            # Gate criteria definitions
    └── ci-reporter.ts         # CI annotation generation
```

### 2.2 Core Types

```typescript
// lib/eval/types.ts

export type EvalStatus = "pass" | "fail" | "warn" | "skip" | "error";

export interface EvalScore {
  name: string;
  status: EvalStatus;
  score: number;            // 0.0 — 1.0
  threshold: number;        // minimum acceptable score
  metrics: Record<string, number>;
  details: string[];
  durationMs: number;
}

export interface EvalSuite {
  name: string;
  description: string;
  version: string;
  cases: EvalCase[];
}

export interface EvalCase {
  id: string;
  name: string;
  description: string;
  tags: string[];           // ["golden", "regression", "speed", "security"]
  input: unknown;
  expectedOutput: unknown;
  evaluationRules: EvalRule[];
  timeoutMs: number;
  retries: number;
}

export interface EvalRule {
  type: string;             // "exact", "fuzzy", "contains", "regex", "latency", "token", "tool", "custom"
  params: Record<string, unknown>;
  weight: number;           // 0.0 — 1.0
  evaluator: string;        // function name in evaluator module
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  status: EvalStatus;
  score: number;
  actualOutput: unknown;
  expectedOutput: unknown;
  metrics: Record<string, number>;
  errors: string[];
  warnings: string[];
  durationMs: number;
  timestamp: number;
}

export interface SuiteReport {
  suiteName: string;
  version: string;
  timestamp: number;
  totalCases: number;
  passed: number;
  failed: number;
  warned: number;
  skipped: number;
  errored: number;
  overallScore: number;
  results: EvalResult[];
  summary: string;
}

export interface RegressionReport extends SuiteReport {
  baselineVersion: string;
  currentVersion: string;
  degradations: DegradationReport[];
  improvements: string[];
}

export interface DegradationReport {
  caseId: string;
  caseName: string;
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  severity: "critical" | "major" | "minor";
}

export interface ModelScorecard {
  modelId: string;
  modelName: string;
  provider: string;
  benchmarkVersion: string;
  timestamp: number;
  scores: {
    reasoning: number;
    coding: number;
    planning: number;
    vision: number;
    longContext: number;
    toolUsage: number;
    reliability: number;
    contextPreservation: number;
    recovery: number;
  };
  metrics: {
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgTokensPerRequest: number;
    costPer1kRequests: number;
    successRate: number;
    retryRate: number;
  };
  rank: number;
  rankCategory: "S" | "A" | "B" | "C" | "D" | "F";
}

export interface EvalGitHubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  title: string;
}
```

### 2.3 Evaluation Runner Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EvaluationRunner                         │
│                                                             │
│  runAll() → runs all suites in parallel-by-suite            │
│  runSuite(name) → runs one suite                            │
│  runCase(caseId) → runs single case                         │
│  quickCheck() → fast smoke test (3 cases from each suite)   │
│                                                             │
│  Pipeline per case:                                         │
│    Input → SystemUnderTest → RawOutput → Evaluator → Score  │
│                                                             │
│  Evaluator pipeline:                                        │
│    RawOutput → Normalizer → Comparator → Scorer → Result    │
└─────────────────────────────────────────────────────────────┘
```

**Evaluation Pipeline (per case):**

```
1. Load Case:      Read golden dataset entry
2. Setup:          Prepare isolated test environment
3. Execute:        Run system under test with case input
4. Capture:        Record output, timing, tokens, tool calls, memory state
5. Normalize:      Strip non-deterministic elements (timestamps, IDs)
6. Compare:        Apply evaluation rules against expected output
7. Score:          Calculate weighted score across rules
8. Report:         Record result + metrics + annotations
```

**Runner CLI interface:**

```bash
# Full evaluation
npx hwai-eval all

# Specific suite
npx hwai-eval suite golden-conversations
npx hwai-eval suite model-benchmark
npx hwai-eval suite regression

# Single case
npx hwai-eval case golden-coding-001

# Quick check (CI pre-merge)
npx hwai-eval quick

# Model benchmark
npx hwai-eval benchmark --models=all

# Regression against baseline
npx hwai-eval regression --baseline=v1.0.0

# Chaos test
npx hwai-eval chaos --kill=all

# Performance benchmark
npx hwai-eval performance --iterations=5
```

---

## 3. Golden Dataset System

### 3.1 Dataset Organization

10 golden dataset categories, each with:
- **Input** — exact input fed to system
- **Expected Output** — expected response characteristics
- **Expected Tool Calls** — which tools should be invoked
- **Expected Memory** — expected memory operations
- **Expected Characteristics** — output shape, length, tone, etc.
- **Evaluation Rules** — how to score correctness

### 3.2 Dataset Schemas

```typescript
// lib/eval/datasets/types.ts

export interface GoldenConversation {
  id: string;
  name: string;
  description: string;
  tags: string[];
  mode: "agent" | "ask" | "mixed";
  turns: GoldenTurn[];
}

export interface GoldenTurn {
  role: "user" | "assistant" | "system";
  content: string;                    // input message
  expectedToolCalls: ExpectedToolCall[];  // tools that SHOULD fire
  forbiddenToolCalls: string[];         // tools that MUST NOT fire
  expectedOutputPattern: ExpectedOutputPattern;
  expectedMemory: ExpectedMemoryOperation[];
  evaluationRules: EvalRule[];
}

export interface ExpectedToolCall {
  toolName: string;
  argsMatch?: Record<string, unknown>;    // exact or partial
  argsPattern?: string;                   // regex for args
  shouldSucceed: boolean;
  maxRetries: number;
  maxLatencyMs: number;
}

export interface ExpectedOutputPattern {
  minLength?: number;
  maxLength?: number;
  mustContain?: string[];              // substrings that must appear
  mustNotContain?: string[];           // substrings that must NOT appear
  mustMatchRegex?: string;             // regex match
  mustNotMatchRegex?: string;          // regex anti-match
  tone?: "professional" | "technical" | "friendly" | "neutral";
  formatting?: "markdown" | "code-blocks" | "plain" | "structured";
  hasCitations?: boolean;
  hasEvidence?: boolean;
}

export interface ExpectedMemoryOperation {
  type: "recall" | "store" | "update" | "delete" | "search";
  entityName?: string;
  observationMatch?: string;
  expectedCount?: number;
  mustSucceed: boolean;
}

export interface GoldenMission {
  id: string;
  name: string;
  description: string;
  tags: string[];
  input: string;                       // mission description
  expectedPlan: ExpectedPlanStep[];
  expectedOutcome: string;
  successCriteria: MissionSuccessCriteria;
  evaluationRules: EvalRule[];
  timeoutMs: number;
}

export interface ExpectedPlanStep {
  order: number;
  description: string;
  requiredTools: string[];
  expectedArtifacts: string[];         // files, outputs, etc.
  verification: string;                // how to verify step completed
}

export interface MissionSuccessCriteria {
  minPlanSteps: number;
  maxPlanSteps: number;
  mustCompleteAllSteps: boolean;
  mustVerifyResults: boolean;
  mustReportEvidence: boolean;
  maxToolCalls: number;
  maxTokens: number;
  maxDurationMs: number;
}

export interface GoldenToolCall {
  id: string;
  name: string;
  toolName: string;
  description: string;
  input: string;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  expectedSuccess: boolean;
  expectedOutputPattern: ExpectedOutputPattern;
  evaluationRules: EvalRule[];
}

export interface GoldenMemoryCase {
  id: string;
  name: string;
  description: string;
  type: "recall" | "injection" | "conflict" | "dedup";
  setup: MemorySetup;
  query: string;
  expectedEntities: ExpectedEntity[];
  evaluationRules: EvalRule[];
}

export interface MemorySetup {
  preExistingEntities: EntityDef[];
  preExistingRelations: RelationDef[];
}

export interface EntityDef {
  name: string;
  entityType: string;
  observations: string[];
}

export interface RelationDef {
  from: string;
  to: string;
  relationType: string;
}

export interface ExpectedEntity {
  name: string;
  mustBeRecalled: boolean;
  expectedObservations: string[];
  expectedRelations: string[];
  maxRank: number;                     // must be in top N results
}

export interface GoldenRecoveryCase {
  id: string;
  name: string;
  description: string;
  fault: FaultInjection;
  preState: PreFaultState;
  expectedRecovery: ExpectedRecovery;
  evaluationRules: EvalRule[];
  timeoutMs: number;
}

export interface FaultInjection {
  target: "pty" | "browser" | "redis" | "database" | "playwright" | "openrouter" | "convex" | "workspace" | "session";
  killMethod: "process" | "connection" | "api-error" | "disk" | "memory" | "network";
  timing: "immediate" | "mid-operation" | "random";
  durationMs: number;                  // how long to maintain fault state
}

export interface PreFaultState {
  hasActiveTask: boolean;
  hasOpenFiles: boolean;
  hasRunningCommands: boolean;
  hasPendingMemoryWrites: boolean;
}

export interface ExpectedRecovery {
  shouldRetry: boolean;
  maxRetryTimeMs: number;
  shouldNotifyUser: boolean;
  shouldPreserveState: boolean;
  expectedRecoveryActions: string[];
  dataShouldBeIntact: boolean;
}
```

### 3.3 Dataset Bootstrapping from Debug Dumps

```
397 debug dumps → classify by pattern → create golden cases

Classification:
  - Simple Q&A (no tools):          ~80  → golden-conversations/simple-qa.ts
  - Single tool call:               ~60  → golden-tools/
  - Multi-tool agent loop:          ~50  → golden-conversations/multi-step.ts
  - Error recovery observed:        ~20  → golden-recovery/
  - Vision/image upload:            ~15  → golden-conversations/vision.ts
  - Memory operations:              ~10  → golden-memory/
  - Long conversations (>10 turns): ~5   → long-session benchmarks
  - Others (mixed):                 ~60  → manual review

Bootstrapping process:
  1. Run classifier over all 397 dumps
  2. Extract: user messages, assistant responses, tool calls, timing, tokens
  3. Convert to GoldenTurn format (user=Input, assistant=ExpectedOutput)
  4. Strip session-specific data (chatId, timestamps, userId)
  5. Add evaluation rules (mustContain key phrases, tool selection, etc.)
  6. Manual review for correctness (is the assistant response actually good?)
  7. Mark as "bootstrapped" (confidence < 1.0) until manually verified
```

### 3.4 Dataset Statistics (Target)

| Dataset | Target Size | Source |
|---|---|---|
| Golden Conversations | 50 cases | 20 bootstrapped + 30 hand-crafted |
| Golden Missions | 20 cases | 10 coding + 5 security + 5 planning |
| Golden Tool Calls | 40 cases | 30 bootstrapped + 10 hand-crafted |
| Golden Memory | 15 cases | 5 recall + 4 injection + 3 conflict + 3 dedup |
| Golden Recovery | 12 cases | 3 per fault target |
| Golden Workspace | 10 cases | file ops + git + env |
| Golden Vision | 10 cases | image understanding |
| Golden Planning | 10 cases | multi-step reasoning |
| Golden Security | 10 cases | injection + traversal + bypass |
| Golden Coding | 20 cases | code gen + bug fix + refactor |
| **TOTAL** | **197 cases** | |

---

## 4. Prompt Regression System

### 4.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   RegressionRunner                          │
│                                                             │
│  Input:                                                     │
│    baselineVersion (e.g., "v1.0.0")                        │
│    currentVersion (e.g., "HEAD")                            │
│                                                             │
│  Process:                                                   │
│    1. Load baseline results from EvalDB                     │
│    2. Run same golden conversations against current code    │
│    3. Compare per-case: output, tokens, latency, tool calls │
│    4. Detect degradations                                   │
│    5. Generate regression report                            │
│                                                             │
│  Regression Types Detected:                                │
│    - Reasoning regression    (different conclusions)        │
│    - Hallucination increase  (new false statements)         │
│    - Tool degradation        (wrong tool, more retries)     │
│    - Memory degradation      (worse recall)                 │
│    - Latency increase        (>20% slower)                  │
│    - Token increase          (>15% more tokens)             │
│    - Cost increase           (>10% more expensive)         │
│    - Quality degradation     (output scores worse)          │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Baseline Versioning

```
Baselines stored in: lib/eval/regression/baselines/

Each baseline:
  - baseline-v1.0.0.json       → full results snapshot
  - baseline-v1.0.0.meta.json  → git SHA, timestamp, model IDs, code fingerprint
  - baseline-v1.0.0.diff.json  → diff from previous baseline

Baseline creation:
  npx hwai-eval baseline create v1.0.0
  → Runs ALL golden datasets against ALL configured models
  → Stores results in EvalDB + JSON file
  → Creates git tag: eval-baseline-v1.0.0

Baseline comparison:
  npx hwai-eval regression --baseline=v1.0.0
  → Runs golden datasets against current code
  → Compares against stored baseline
  → Reports regressions AND improvements
```

### 4.3 Degradation Detectors

```typescript
// lib/eval/regression/detectors.ts

export interface DetectorResult {
  detected: boolean;
  severity: "critical" | "major" | "minor";
  confidence: number;
  delta: number;
  deltaPercent: number;
  evidence: string;
}

export const degradationDetectors = {
  reasoning: (baseline: string, current: string): DetectorResult => {
    // Semantic similarity between baseline and current reasoning traces
    // Uses embedding comparison or keyword/entity overlap
  },
  
  hallucination: (baseline: string, current: string): DetectorResult => {
    // Count factual claims, compare against known-truth database
    // Check for fabricated URLs, invented function names, non-existent tools
  },
  
  toolDegradation: (baseline: ToolCall[], current: ToolCall[]): DetectorResult => {
    // Compare: tool selection accuracy, retry rate, failure rate, latency
  },
  
  memoryDegradation: (baseline: MemoryResult, current: MemoryResult): DetectorResult => {
    // Compare: recall accuracy, precision, conflict rate
  },
  
  latencyIncrease: (baselineMs: number, currentMs: number): DetectorResult => {
    const delta = ((currentMs - baselineMs) / baselineMs) * 100;
    return {
      detected: delta > 20,
      severity: delta > 50 ? "critical" : delta > 30 ? "major" : "minor",
      confidence: 1.0,
      delta: currentMs - baselineMs,
      deltaPercent: delta,
      evidence: `Latency ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(1)}%`,
    };
  },
  
  tokenIncrease: (baselineTokens: number, currentTokens: number): DetectorResult => {
    const delta = ((currentTokens - baselineTokens) / baselineTokens) * 100;
    return {
      detected: delta > 15,
      severity: delta > 40 ? "critical" : delta > 25 ? "major" : "minor",
      confidence: 1.0,
      delta: currentTokens - baselineTokens,
      deltaPercent: delta,
      evidence: `Token count ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta).toFixed(1)}%`,
    };
  },
};

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: "success" | "failure" | "retry";
  durationMs: number;
  retryCount: number;
}

export interface MemoryResult {
  recallAccuracy: number;
  precision: number;
  falsePositives: number;
  falseNegatives: number;
}
```

---

## 5. Tool Evaluation

### 5.1 Metrics

```typescript
// lib/eval/tool-evaluator/types.ts

export interface ToolEvalMetrics {
  // Selection
  correctToolSelected: number;      // correct tool picked
  wrongToolSelected: number;        // wrong tool picked
  toolSelectionAccuracy: number;    // correct / total
  
  // Execution
  toolSuccess: number;              // tool completed successfully
  toolFailure: number;              // tool failed
  toolRetry: number;                // tool was retried
  toolRetryRate: number;            // retries / total calls
  toolRecoverySuccess: number;      // successfully recovered from failure
  toolRecoveryRate: number;         // recoveries / failures
  
  // Performance
  avgToolLatencyMs: number;
  p50ToolLatencyMs: number;
  p95ToolLatencyMs: number;
  p99ToolLatencyMs: number;
  
  // Evidence
  evidenceProvided: number;         // tool output used in response
  evidenceQuality: number;          // 0.0 — 1.0 (is evidence relevant?)
  evidenceCitations: number;        // explicit citations of tool output
}
```

### 5.2 Evaluation Logic

```typescript
// lib/eval/tool-evaluator/correctness.ts

export function evaluateToolSelection(
  expected: ExpectedToolCall[],
  actual: ToolCall[],
): ToolEvalMetrics {
  // Match actual calls against expected
  //   - Name match: did it pick the right tool?
  //   - Args match: did it provide the right arguments?
  //   - Should have called but didn't
  //   - Should NOT have called but did
  
  // Scoring:
  //   - Each expected tool call matched to actual → +correctToolSelected
  //   - Expected but not called → miss (counts against accuracy)
  //   - Called but not expected → wrongToolSelected
  //   - Args don't match expected → partial credit (0.5)
}
```

---

## 6. Memory Evaluation

### 6.1 Metrics

```typescript
// lib/eval/memory-evaluator/types.ts

export interface MemoryEvalMetrics {
  // Recall
  recallAccuracy: number;           // retrieved correct / total correct
  recallPrecision: number;          // retrieved correct / total retrieved
  recallF1: number;                 // harmonic mean of accuracy + precision
  
  // Injection
  injectionAccuracy: number;        // correct entities stored / attempted
  injectionDuplicates: number;      // duplicate entities after injection
  injectionConflicts: number;       // conflicting observations
  
  // Quality
  memoryFreshness: number;          // avg age of retrieved memories
  memoryRelevance: number;          // relevance score 0-1
  memoryCompleteness: number;       // did it retrieve ALL needed memories?
  
  // Performance
  avgSearchTimeMs: number;
  p95SearchTimeMs: number;
  indexSize: number;               // total entities in memory
  relationCount: number;            // total relations
}
```

### 6.2 Test Harness

```
Memory Evaluation Flow:
  1. Seed knowledge graph with known entities + relations
  2. Execute query/operation
  3. Compare retrieved entities against expected
  4. Measure precision, recall, F1
  5. Check for duplicates, conflicts

Scoring:
  recallAccuracy > 0.9  → pass
  recallPrecision > 0.85 → pass
  recallF1 > 0.80        → pass
  injectionAccuracy > 0.95 → pass
  conflicts === 0        → pass
```

---

## 7. Executive Evaluation

### 7.1 Evaluation Dimensions

```typescript
// lib/eval/executive-evaluator/types.ts

export interface ExecutiveEvalMetrics {
  // Planning
  planCompleteness: number;         // did it plan all steps?
  planCorrectness: number;          // are steps correct?
  planEfficiency: number;           // is it the optimal plan?
  planAdaptability: number;         // does it adapt when plan fails?
  
  // Decision
  decisionAccuracy: number;         // were decisions correct?
  decisionConfidence: number;       // did it express appropriate confidence?
  decisionSpeedMs: number;          // how fast were decisions made?
  
  // Delegation
  delegationAccuracy: number;       // tasks delegated to right agents
  delegationCompleteness: number;   // all tasks delegated
  delegationOverhead: number;       // unnecessary delegation
  
  // Mission
  missionSuccessRate: number;       // missions completed successfully
  missionPartialSuccess: number;    // missions partially completed
  missionFailure: number;           // missions abandoned/failed
  
  // Recovery
  recoveryDetected: number;         // did it detect failures?
  recoveryCorrect: number;          // did it choose right recovery?
  recoveryEffectiveness: number;    // did recovery work?
  
  // Verification
  verificationAttempted: number;    // did it attempt verification?
  verificationCorrect: number;      // was verification accurate?
  evidenceCollected: number;        // was evidence gathered?
  evidenceQuality: number;          // 0-1 quality score
}
```

### 7.2 Executive Scoring

```
Each executive is evaluated independently:

  1. StrategyExecutive    → planning, adaptability
  2. OverseerExecutive    → completeness, verification
  3. EthicsExecutive      → safety violations detected
  4. ToolExecutive         → tool selection accuracy
  5. MemoryExecutive       → memory recall/injection
  6. MissionExecutive      → mission success rate
  7. RecoveryExecutive     → recovery detection + effectiveness
  8. VerificationExecutive → verification accuracy + evidence

Composite score = weighted average:
  strategy: 0.15, overseer: 0.15, ethics: 0.10, tool: 0.15,
  memory: 0.10, mission: 0.15, recovery: 0.10, verification: 0.10
```

---

## 8. Model Benchmark System

### 8.1 Benchmark Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    ModelBenchmarkRunner                      │
│                                                              │
│  For each model in config/models.json:                      │
│    For each golden dataset category:                         │
│      Run all cases against model                            │
│      Score each case                                        │
│      Aggregate per category                                 │
│    Generate model scorecard                                 │
│  Rank all models                                            │
│  Generate comparison report                                 │
│                                                              │
│  Cost tracking:                                              │
│    Total tokens × $/token rate = estimated cost             │
│    Compare cost-per-quality-point across models             │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Scorecard Dimensions

| Dimension | Weight | Evaluator | Golden Dataset |
|---|---|---|---|
| Reasoning | 0.15 | Compare expected vs actual conclusions | golden-conversations |
| Coding | 0.15 | Code correctness, tests pass, style | golden-coding |
| Planning | 0.12 | Plan completeness, step correctness | golden-planning |
| Vision | 0.08 | Image understanding accuracy | golden-vision |
| Long Context | 0.10 | Performance at 50/100/500/1000 turns | long-session |
| Tool Usage | 0.12 | Tool selection, args, success rate | golden-tool-calls |
| Reliability | 0.10 | Error rate, retry rate, recovery | golden-recovery |
| Context Preservation | 0.08 | Key info preserved across turns | long-session |
| Recovery | 0.10 | Recovery from faults | golden-recovery |
| **TOTAL** | **1.00** | | |

### 8.3 Model Ranking

```
Rank Categories:
  S: > 0.90  — exceptional, use as primary
  A: 0.80-0.90  — strong, use as fallback
  B: 0.65-0.80  — adequate, use for simple tasks
  C: 0.50-0.65  — below average, avoid for critical
  D: 0.35-0.50  — poor, only for cost-minimization
  F: < 0.35  — failing, remove from rotation

Model comparison matrix:
  [model-a] vs [model-b] → delta per dimension
  Pareto frontier: models that are NOT dominated on ALL dimensions

Cost-efficiency score:
  ce_score = composite_quality_score / cost_per_1k_requests
```

### 8.4 Benchmark Runner Flow

```
1. Load model list from config/models.json
2. For each model:
   a. Create separate conversation context
   b. Set model via AI SDK config
   c. Run ALL golden cases from ALL categories
   d. Record all outputs, tool calls, timing, tokens
   e. Score each case
   f. Aggregate into category scores
   g. Generate ModelScorecard
3. Rank all models
4. Generate comparison report
5. Store results in EvalDB
6. Output: JSON report + HTML dashboard
```

---

## 9. AI Telemetry

### 9.1 Extending Observability Engine

The existing `lib/observability/engine.ts` provides the foundation. Extend with eval-specific metrics:

```typescript
// lib/eval/telemetry/collectors.ts

export interface EvalTelemetry extends MetricsRegistry {
  // Mission metrics
  missionAttempted: Counter;
  missionSucceeded: Counter;
  missionFailed: Counter;
  missionPartiallySucceeded: Counter;
  
  // Executive metrics
  executiveDecisions: Counter;
  executiveCorrectDecisions: Counter;
  executiveIncorrectDecisions: Counter;
  
  // Agent metrics
  agentTasksCreated: Counter;
  agentTasksCompleted: Counter;
  agentTasksFailed: Counter;
  
  // Tool metrics
  toolCallsTotal: Counter;
  toolCallsSucceeded: Counter;
  toolCallsFailed: Counter;
  toolCallsRetried: Counter;
  toolCallsRecovered: Counter;
  
  // Recovery metrics
  recoveriesAttempted: Counter;
  recoveriesSucceeded: Counter;
  
  // Memory metrics
  memoryWrites: Counter;
  memoryReads: Counter;
  memorySearchHits: Counter;
  memorySearchMisses: Counter;
  
  // Hallucination metrics
  hallucinationChecks: Counter;
  hallucinationsDetected: Counter;
  hallucinationsSevere: Counter;
  
  // Performance metrics
  contextBuildTimeMs: Histogram;
  checkpointSaveTimeMs: Histogram;
  checkpointRestoreTimeMs: Histogram;
  missionResumeTimeMs: Histogram;
  
  // Token/cost metrics
  tokensInputTotal: Counter;
  tokensOutputTotal: Counter;
  costTotalDollars: Counter;
  
  // Latency metrics
  apiLatencyMs: Histogram;
  toolLatencyMs: Histogram;
  memorySearchLatencyMs: Histogram;
  endToEndLatencyMs: Histogram;
}
```

### 9.2 Telemetry Collection Points

```
collection points in existing code:

  chat-handler.ts:
    - prepareStep → start span, record model
    - onStepFinish → end span, record tokens, tool calls, finish reason
    - after stream → record total cost, end-to-end latency

  executive-kernel.ts:
    - prepareStep → count executive decisions
    - onStepFinish → count correct/incorrect by comparing expected output

  context-builder.ts:
    - buildContext() → record build time, context size, message count

  persistence flow:
    - saveCheckpoint → record save time
    - resumeCheckpoint → record restore time, resume success/failure

  tool execution:
    - each tool call → record tool name, duration, success/failure, retry count

  memory operations:
    - each memory read/write/search → record operation, duration, hit/miss
```

### 9.3 Telemetry Data Flow

```
Collection Points → In-Memory MetricsRegistry → Periodic Flush
                                                    │
                                          ┌─────────┴──────────┐
                                          ▼                     ▼
                                    SQLite (EvalDB)       Prometheus Endpoint
                                          │               (GET /api/metrics)
                                          ▼
                                    Dashboard API
                                    (GET /api/eval/telemetry)
```

---

## 10. Chaos Evaluation

### 10.1 Fault Injection Catalog

| Fault Target | Kill Method | Timing | Recovery Expectation |
|---|---|---|---|
| **PTY** | Kill bash process | Mid-command | Retry command, recreate PTY, notify user |
| **Browser** | Kill Playwright process | Mid-page-load | Recreate browser, reload page, retry action |
| **Redis** | Kill redis-server | During memory write | Buffer writes, reconnect, replay |
| **Database** | Kill SQLite (lock file) | During checkpoint | Reopen connection, verify integrity, retry |
| **Playwright** | Kill chromium process | Mid-browser-op | Restart Playwright, relogin, retry |
| **OpenRouter** | Return HTTP 503 | Mid-request | Retry with backoff, switch model, notify |
| **Convex** | Disconnect mock client | During message save | Retry mutation, fallback to local, notify |
| **Workspace** | Delete CWD directory | Mid-file-op | Recreate workspace, report loss, continue |
| **Session** | Kill kernel + PTY simultaneously | Anytime | Full recovery protocol, restore from checkpoint |

### 10.2 Chaos Test Execution

```
ChaosSuite.run():
  1. Setup: Start a conversation with a multi-step task
  2. Execute 2-3 steps normally (establish baseline)
  3. Inject fault (kill target)
  4. Wait for recovery timeout (30s)
  5. Evaluate:
     a. Did it detect the fault?
     b. Did it attempt recovery?
     c. Did recovery succeed?
     d. Did it preserve state?
     e. Did it notify the user appropriately?
     f. Did it resume the task correctly?
  6. Score per fault type
  7. Aggregate recovery score
```

### 10.3 Recovery Quality Metrics

```typescript
export interface RecoveryQualityMetrics {
  faultDetected: boolean;           // did system notice the fault?
  detectionTimeMs: number;          // how long to detect?
  recoveryAttempted: boolean;       // did it try to recover?
  recoverySucceeded: boolean;       // did recovery work?
  recoveryDurationMs: number;       // time from detection to recovery
  statePreserved: boolean;          // was task state preserved?
  userNotified: boolean;            // was user informed?
  gracefulDegradation: boolean;     // did it degrade gracefully?
  dataIntegrity: boolean;           // was any data corrupted?
  overallScore: number;             // 0.0 — 1.0
}
```

---

## 11. Long Session Evaluation

### 11.1 Session Benchmarks

| Benchmark | Turns | Target Metrics |
|---|---|---|
| **100-Turn** | 100 | Context preservation > 90%, memory recall > 90%, no tool degradation |
| **500-Turn** | 500 | Context preservation > 85%, memory growth < 1000 entities, reasoning stable |
| **1000-Turn** | 1000 | Context preservation > 80%, no checkpoint corruption, stable latency |

### 11.2 Session Generator

```
LongSessionGenerator:
  1. Create conversation with seed topic
  2. For each turn (1..N):
     a. Generate follow-up question based on context
     b. If turn % 10 === 0, inject memory test (recall earlier fact)
     c. If turn % 25 === 0, inject tool task (verify tool still works)
     d. If turn % 50 === 0, save + restore checkpoint (verify persistence)
     e. If turn % 100 === 0, inject mission (verify multi-step reasoning)
  3. Track all metrics over turns
  4. Analyze degradation curve
```

### 11.3 Long Session Metrics

```typescript
export interface LongSessionMetrics {
  totalTurns: number;
  successfulTurns: number;
  
  // Stability metrics
  reasoningStability: number[];     // per-turn reasoning quality scores
  toolStability: number[];          // per-turn tool accuracy scores
  memoryStability: number[];        // per-turn memory recall scores
  
  // Growth metrics
  contextSizeGrowth: number[];      // message count over turns
  memoryEntityGrowth: number[];     // knowledge graph size over turns
  tokenUsageGrowth: number[];       // tokens per turn over time
  
  // Performance metrics
  latencyOverTurns: number[];       // response time per turn
  checkpointSizeGrowth: number[];   // checkpoint size over time
  
  // Degradation analysis
  degradationPoint: number;         // turn number where quality drops > 10%
  maxStableTurns: number;           // max turns before unacceptable degradation
  recoveryFromDegradation: boolean; // did it recover from quality drop?
}
```

---

## 12. Performance Benchmarks

### 12.1 Benchmark Scenarios

```typescript
// lib/eval/performance/benchmarks.ts

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  iterations: number;              // how many times to run
  warmupIterations: number;        // omitted from results
  measure: BenchmarkMeasure[];
}

export interface BenchmarkMeasure {
  name: string;
  unit: "ms" | "MB" | "ops/s" | "tokens" | "USD" | "%";
  target: number;                  // target threshold
  max: number;                     // max acceptable threshold
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "startup",
    name: "Application Startup",
    description: "Time from cold start to first API response",
    iterations: 10,
    warmupIterations: 2,
    measure: [
      { name: "cold_start_ms", unit: "ms", target: 2000, max: 5000 },
      { name: "warm_start_ms", unit: "ms", target: 500, max: 1000 },
      { name: "memory_mb", unit: "MB", target: 200, max: 500 },
    ],
  },
  {
    id: "mission-planning",
    name: "Mission Planning Performance",
    description: "Time to generate a plan for a standard mission",
    iterations: 5,
    warmupIterations: 1,
    measure: [
      { name: "planning_time_ms", unit: "ms", target: 5000, max: 15000 },
      { name: "planning_tokens", unit: "tokens", target: 2000, max: 5000 },
      { name: "planning_cost", unit: "USD", target: 0.005, max: 0.02 },
    ],
  },
  {
    id: "tool-calls",
    name: "Tool Call Performance",
    description: "Latency of individual tool operations",
    iterations: 20,
    warmupIterations: 5,
    measure: [
      { name: "bash_exec_ms", unit: "ms", target: 500, max: 2000 },
      { name: "file_read_ms", unit: "ms", target: 100, max: 500 },
      { name: "file_write_ms", unit: "ms", target: 200, max: 1000 },
      { name: "browser_nav_ms", unit: "ms", target: 3000, max: 10000 },
      { name: "memory_search_ms", unit: "ms", target: 200, max: 1000 },
    ],
  },
  {
    id: "context-build",
    name: "Context Building Performance",
    description: "Time to assemble context for a request",
    iterations: 20,
    warmupIterations: 5,
    measure: [
      { name: "context_build_ms", unit: "ms", target: 50, max: 200 },
      { name: "context_size_tokens", unit: "tokens", target: 5000, max: 15000 },
      { name: "context_messages", unit: "ops/s", target: 50, max: 100 },
    ],
  },
  {
    id: "checkpoint",
    name: "Checkpoint Performance",
    description: "Checkpoint save and restore times",
    iterations: 10,
    warmupIterations: 2,
    measure: [
      { name: "save_time_ms", unit: "ms", target: 100, max: 500 },
      { name: "restore_time_ms", unit: "ms", target: 200, max: 1000 },
      { name: "checkpoint_size_kb", unit: "MB", target: 100, max: 500 },
    ],
  },
  {
    id: "mission-resume",
    name: "Mission Resume Performance",
    description: "Time to resume a mission from checkpoint",
    iterations: 5,
    warmupIterations: 1,
    measure: [
      { name: "resume_time_ms", unit: "ms", target: 2000, max: 5000 },
      { name: "resume_tokens", unit: "tokens", target: 1000, max: 3000 },
    ],
  },
];
```

### 12.2 Performance Report

```typescript
export interface PerformanceReport {
  scenario: string;
  timestamp: number;
  gitSha: string;
  iterations: number;
  measures: PerformanceMeasure[];
}

export interface PerformanceMeasure {
  name: string;
  unit: string;
  target: number;
  max: number;
  actual: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  passed: boolean;
  withinTarget: boolean;
  withinMax: boolean;
}
```

---

## 13. Evaluation Dashboard

### 13.1 Dashboard Data API

```
GET /api/eval/dashboard
  → Overall evaluation health

GET /api/eval/dashboard/missions
  → Mission accuracy over time

GET /api/eval/dashboard/models
  → Model rankings and scorecards

GET /api/eval/dashboard/regression
  → Regression history timeline

GET /api/eval/dashboard/benchmarks
  → Benchmark trends over versions

GET /api/eval/dashboard/performance
  → Performance trends

GET /api/eval/dashboard/memory
  → Memory accuracy trends

GET /api/eval/dashboard/tools
  → Tool reliability metrics

GET /api/eval/dashboard/executives
  → Executive health scores

GET /api/eval/dashboard/telemetry
  → Raw telemetry data
```

### 13.2 Dashboard Data Structure

```typescript
export interface EvalDashboard {
  timestamp: number;
  version: string;
  gitSha: string;
  
  // Summary
  summary: {
    overallHealth: "healthy" | "degraded" | "failing";
    activeRegressions: number;
    criticalRegressions: number;
    lastFullEval: number;        // timestamp
    lastBaseline: string;        // version
  };
  
  // Trend data (time series)
  trends: {
    missionAccuracy: TimeSeriesPoint[];
    modelQuality: TimeSeriesPoint[];
    benchmarkScores: TimeSeriesPoint[];
    performanceMetrics: TimeSeriesPoint[];
    memoryAccuracy: TimeSeriesPoint[];
    toolReliability: TimeSeriesPoint[];
  };
  
  // Rankings
  rankings: {
    modelRankings: ModelScorecard[];
    toolRankings: { toolName: string; reliability: number; avgLatency: number }[];
    executiveRankings: { executiveName: string; score: number }[];
  };
  
  // Current state
  current: {
    regressionSummary: RegressionReport | null;
    benchmarkSummary: SuiteReport | null;
    performanceSummary: PerformanceReport | null;
    chaosSummary: SuiteReport | null;
    longSessionSummary: LongSessionMetrics | null;
  };
  
  // Quality gate status
  gates: {
    promptRegression: GateStatus;
    goldenDataset: GateStatus;
    toolAccuracy: GateStatus;
    memoryAccuracy: GateStatus;
    coverage: GateStatus;
    benchmarks: GateStatus;
    performance: GateStatus;
    overall: GateStatus;
  };
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  label: string;
}

export interface GateStatus {
  passed: boolean;
  score: number;
  threshold: number;
  delta: number;
  status: "pass" | "fail" | "warn" | "not_run";
  lastRun: number;
}
```

### 13.3 Dashboard API Routes

```
lib/eval/dashboard/routes.ts

  GET  /api/eval/dashboard          → EvalDashboard
  GET  /api/eval/dashboard/:section → section subset
  GET  /api/eval/history           → historical results from EvalDB
  GET  /api/eval/results/:runId    → single run results

  Dashboard data source:
    EvalDB (SQLite) — historical results
    MetricsRegistry — current metrics
    Git — version/baseline tracking
```

---

## 14. Quality Gates

### 14.1 Gate Architecture

```
QualityGateRunner:

  For each PR / merge to main:
    Run evaluation suite against PR branch
    Compare against main branch baseline
    Apply gate criteria
    Generate gate report → GitHub Checks API
    Block merge if any gate fails

Gate categories:
  P0 (BLOCKING):    Must pass for merge
  P1 (WARNING):     Should pass, comment on PR
  P2 (INFO):        Informational only, no action required
```

### 14.2 Gate Criteria

```typescript
// lib/eval/gates/criteria.ts

export interface GateCriteria {
  id: string;
  name: string;
  description: string;
  priority: "P0" | "P1" | "P2";
  check: () => Promise<GateResult>;
  threshold: number;
  tolerance: number;                // acceptable degradation (0.0 — 1.0)
}

export interface GateResult {
  passed: boolean;
  score: number;
  threshold: number;
  delta: number;
  baselineScore: number;
  currentScore: number;
  details: string;
}

export const QUALITY_GATES: GateCriteria[] = [
  {
    id: "prompt-regression",
    name: "Prompt Regression",
    description: "No new prompt-related regressions detected",
    priority: "P0",
    threshold: 0.95,
    tolerance: 0.05,
    check: async () => {
      // Run regression suite against baseline
      // Pass if: overall score >= 0.95 AND no critical degradations
    },
  },
  {
    id: "golden-dataset",
    name: "Golden Dataset",
    description: "All golden dataset cases pass",
    priority: "P0",
    threshold: 0.98,
    tolerance: 0.02,
    check: async () => {
      // Run ALL golden cases
      // Pass if: > 98% pass rate AND no P0 case failures
    },
  },
  {
    id: "tool-accuracy",
    name: "Tool Accuracy",
    description: "Tool selection accuracy within bounds",
    priority: "P0",
    threshold: 0.90,
    tolerance: 0.02,
    check: async () => {
      // Run tool evaluation suite
      // Pass if: toolSelectionAccuracy >= 0.90
    },
  },
  {
    id: "memory-accuracy",
    name: "Memory Accuracy",
    description: "Memory recall and precision within bounds",
    priority: "P0",
    threshold: 0.85,
    tolerance: 0.03,
    check: async () => {
      // Run memory evaluation suite
      // Pass if: recallF1 >= 0.85
    },
  },
  {
    id: "coverage",
    name: "Code Coverage",
    description: "Core AI module coverage thresholds met",
    priority: "P0",
    threshold: 0.70,
    tolerance: 0.02,
    check: async () => {
      // Read coverage from jest output
      // Pass if: lines >= 70% AND branches >= 60% AND functions >= 60%
    },
  },
  {
    id: "benchmarks",
    name: "Model Benchmarks",
    description: "All configured models above minimum quality",
    priority: "P1",
    threshold: 0.50,
    tolerance: 0.05,
    check: async () => {
      // Run model benchmarks
      // Pass if: all models score >= 0.50
      // Warn if: any model scores < 0.50
    },
  },
  {
    id: "performance",
    name: "Performance",
    description: "No significant performance regressions",
    priority: "P0",
    threshold: 0.90,
    tolerance: 0.05,
    check: async () => {
      // Run performance benchmarks
      // Pass if: all measures within max threshold
      // Pass if: > 90% measures within target
    },
  },
  {
    id: "no-critical-regressions",
    name: "No Critical Regressions",
    description: "Zero critical regressions from baseline",
    priority: "P0",
    threshold: 1.0,
    tolerance: 0.0,
    check: async () => {
      // Run regression detection
      // Pass if: criticalRegressions === 0
    },
  },
];
```

### 14.3 CI Integration

```yaml
# .github/workflows/eval.yml

name: AI Evaluation Gates

on:
  pull_request:
    branches: [main]
    paths:
      - 'lib/ai/**'
      - 'lib/api/**'
      - 'lib/memory/**'
      - 'lib/context-builder/**'
      - 'config/models.json'
      - 'app/components/chat.tsx'
      - 'app/hooks/useChatHandlers.ts'

jobs:
  eval-quick:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v4
        with: { node-version: '20.x', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: npx hwai-eval quick
      - name: Post results to PR
        if: always()
        uses: actions/github-script@v6
        with:
          script: |
            // Parse eval results JSON
            // Create check run with annotations

  eval-full:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: npx hwai-eval all
      - run: npx hwai-eval baseline create ${{ github.sha }}
      - uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: data/eval/
```

### 14.4 Merge Gate Summary

```
PR #123 "Add tool capability registry"

  Quality Gates:
    ✅ prompt-regression      0.98/0.95  (+0.03)  PASS
    ✅ golden-dataset         0.99/0.98  (+0.01)  PASS
    ✅ tool-accuracy          0.94/0.90  (+0.04)  PASS
    ✅ memory-accuracy        0.88/0.85  (+0.03)  PASS
    ✅ coverage               0.72/0.70  (+0.02)  PASS
    ⚠️ model-benchmarks       0.48/0.50  (-0.02)  WARN (deepseek-v4-flash)
    ✅ performance            0.93/0.90  (+0.03)  PASS
    ✅ no-critical-regressions  PASS (0 critical)

  Verdict: ✅ ALL P0 GATES PASSED — Ready to merge
```

---

## 15. Implementation Plan

### Phase 0: Foundation (Sprint -0.8a)

| Task | Effort | Depends On |
|---|---|---|
| Create `lib/eval/` directory structure | Small | — |
| Create `lib/eval/types.ts` (all shared types) | Small | — |
| Create `lib/eval/database.ts` (EvalDB schema) | Medium | types.ts |
| Extend feature flags for eval toggling | Small | — |
| Create `lib/eval/runner.ts` (EvaluationRunner) | Medium | types.ts |
| Create `lib/eval/reporter.ts` (ScoreReporter) | Medium | types.ts |
| Wire Jest + Eval config (test:eval script) | Small | — |
| Create CI workflow `.github/workflows/eval.yml` | Small | — |

### Phase 1: Golden Dataset System (Sprint -0.8b)

| Task | Effort | Depends On |
|---|---|---|
| Dataset classifier (classify 397 debug dumps) | Medium | database.ts |
| Bootstrap golden conversations from dumps | Medium | classifier |
| Create hand-crafted golden cases for each category | Large | — |
| Create `lib/eval/datasets/types.ts` | Small | types.ts |
| Create `lib/eval/datasets/index.ts` (DatasetRegistry) | Medium | types.ts |
| Populate golden conversations | Large | — |
| Populate golden missions | Large | — |
| Populate golden tool calls | Medium | — |
| Populate golden memory cases | Small | — |
| Populate golden recovery cases | Small | — |

### Phase 2: Regression System (Sprint -0.8c)

| Task | Effort | Depends On |
|---|---|---|
| Create `lib/eval/regression/baseline-store.ts` | Medium | database.ts |
| Create `lib/eval/regression/comparators.ts` | Medium | types.ts |
| Create `lib/eval/regression/detectors.ts` | Medium | comparators.ts |
| Create `lib/eval/regression/runner.ts` | Medium | baseline-store, detectors |
| Create baseline for HEAD commit | Small | all golden datasets |
| Test regression detection with known-good regressions | Small | runner.ts |

### Phase 3: Evaluator Modules (Sprint -0.8d)

| Task | Effort | Depends On |
|---|---|---|
| Tool Evaluator (`lib/eval/tool-evaluator/`) | Medium | golden tool calls |
| Memory Evaluator (`lib/eval/memory-evaluator/`) | Medium | golden memory |
| Executive Evaluator (`lib/eval/executive-evaluator/`) | Medium | golden missions |
| Chaos Evaluator (`lib/eval/chaos/`) | Large | — |

### Phase 4: Model Benchmarking (Sprint -0.8e)

| Task | Effort | Depends On |
|---|---|---|
| Model Benchmark Runner | Large | all golden datasets |
| Scorecard generation | Medium | runner |
| Model ranking algorithm | Small | scorecards |
| Model comparison report | Medium | rankings |

### Phase 5: Telemetry + Dashboard (Sprint -0.8f)

| Task | Effort | Depends On |
|---|---|---|
| Extend observability engine for eval | Medium | observability/engine.ts |
| Create eval telemetry collectors | Medium | extended engine |
| Create dashboard data API (`/api/eval/*`) | Medium | telemetry |
| Dashboards route for each category | Small | dashboard API |

### Phase 6: Long Session + Performance (Sprint -0.8g)

| Task | Effort | Depends On |
|---|---|---|
| Long Session Generator | Large | runner |
| Long Session Stability Analysis | Medium | generator |
| Performance Benchmark Runner | Medium | runner |
| Performance Profiler (CPU/RAM/Disk) | Small | runner |

### Phase 7: Quality Gates (Sprint -0.8h)

| Task | Effort | Depends On |
|---|---|---|
| Gate criteria definitions | Medium | all evaluators |
| Gate runner | Medium | criteria |
| CI integration (eval.yml) | Small | gate runner |
| GitHub Check Run annotations | Small | CI integration |

### Phase 8: Bootstrap + Baseline (Sprint -0.8i)

| Task | Effort | Depends On |
|---|---|---|
| Run classifier over 397 debug dumps | Medium | dataset classifier |
| Manual review of bootstrapped cases | Large | classified dumps |
| Hand-craft missing categories | Large | — |
| Create baseline v0.1.0 | Small | all datasets |
| Run first full evaluation | Medium | baseline |
| Verify quality gates | Small | full evaluation |

---

## 16. Technical Decisions

### 16.1 Database

```
EvalDB (SQLite, separate from chat DB):
  Path: data/eval/eval.db

  Tables:
    eval_runs          — each evaluation run
    eval_results       — per-case results
    eval_baselines     — baseline version snapshots
    eval_scorecards    — model scorecards
    eval_benchmarks    — benchmark results
    eval_performance   — performance measurements
    eval_regressions   — regression reports
    eval_chaos         — chaos test results
    eval_long_session  — long session metrics
    eval_gates         — gate results per run
```

### 16.2 Isolation

```
Each evaluation case runs in isolation:
  - Fresh in-memory MetricsRegistry
  - Mocked database connections (if needed)
  - Mocked OpenRouter/Convex
  - No side effects on production data
  - No network calls to real APIs (replay mode)
```

### 16.3 Mocking AI Responses

```
For deterministic regression testing:
  - Record real API responses as fixtures
  - Replay fixtures during evaluation
  - This eliminates AI non-determinism
  - Only test code changes, not model variation

  Replay mode:
    npx hwai-eval regression --replay
    → Uses recorded responses instead of real API calls
  
  Live mode:
    npx hwai-eval regression --live
    → Uses real API calls (for full end-to-end validation)
```

### 16.4 Confidence Scoring

```
Each bootstrapped golden case has a confidence score:
  1.0 = manually verified
  0.8 = algorithmically verified (mustContain patterns match)
  0.6 = classified from dump, unverified
  0.4 = auto-generated, untested

  Cases with confidence < 0.8:
    - Run in evaluation but don't block gates
    - Flagged for manual review
    - Aggregate into "unverified" category in reports
```

---

## 17. Metrics Matrix

### 17.1 All Evaluation Metrics

```
Evaluation Dimensions × Metrics Matrix:

PROMPT EVALUATION:
  output_similarity     0.0-1.0  Semantic similarity to expected
  hallucination_rate    0.0-1.0  Fabricated claims per response
  reasoning_accuracy    0.0-1.0  Correct conclusion rate
  output_quality        0.0-1.0  Formatting, completeness, tone

TOOL EVALUATION:
  tool_selection_acc    0.0-1.0  Correct tool chosen
  tool_args_acc         0.0-1.0  Correct arguments
  tool_success_rate     0.0-1.0  Tools that succeeded
  tool_retry_rate       0.0-1.0  Retries per call
  tool_recovery_rate    0.0-1.0  Successful recoveries
  tool_latency_ms       ms        Average tool execution time
  evidence_quality      0.0-1.0  Evidence relevance score

MEMORY EVALUATION:
  recall_accuracy       0.0-1.0  Correctly retrieved
  recall_precision      0.0-1.0  Precision of retrieval
  recall_f1             0.0-1.0  Harmonic mean
  injection_accuracy    0.0-1.0  Correctly stored
  duplicate_rate        0.0-1.0  Duplicate entities
  conflict_rate         0.0-1.0  Conflicting observations
  search_latency_ms     ms        Search time

EXECUTIVE EVALUATION:
  planning_score        0.0-1.0  Plan completeness + correctness
  decision_score        0.0-1.0  Decision accuracy
  delegation_score      0.0-1.0  Task delegation accuracy
  mission_success_rate  0.0-1.0  Missions completed
  verification_score    0.0-1.0  Verification accuracy

MODEL BENCHMARK:
  composite_score       0.0-1.0  Weighted across dimensions
  reasoning_score       0.0-1.0  Reasoning quality
  coding_score          0.0-1.0  Code generation quality
  planning_score        0.0-1.0  Planning ability
  vision_score          0.0-1.0  Image understanding
  long_context_score    0.0-1.0  Context preservation
  tool_usage_score      0.0-1.0  Tool proficiency
  reliability_score     0.0-1.0  Error/resilience
  recovery_score        0.0-1.0  Recovery capability
  cost_efficiency        score/$  Quality per dollar

CHAOS EVALUATION:
  recovery_detection    0.0-1.0  Fault detection rate
  recovery_success      0.0-1.0  Successful recovery rate
  recovery_time_ms      ms        Time to recover
  state_preservation    0.0-1.0  State preserved after recovery
  data_integrity        0.0-1.0  Data not corrupted

LONG SESSION:
  context_preservation  0.0-1.0  Info preserved across turns
  memory_stability      0.0-1.0  Memory quality over time
  reasoning_stability   0.0-1.0  Reasoning quality over time
  tool_stability        0.0-1.0  Tool quality over time
  degradation_point     turn      Turn where quality drops
  max_stable_turns      turns     Max stable conversation length

PERFORMANCE:
  cold_start_ms          ms        Cold start latency
  warm_start_ms          ms        Warm start latency
  planning_time_ms       ms        Mission planning time
  context_build_ms       ms        Context assembly time
  checkpoint_save_ms     ms        Checkpoint save time
  checkpoint_restore_ms  ms        Checkpoint restore time
  mission_resume_ms      ms        Mission resume time
  memory_usage_mb        MB        Memory usage
  disk_usage_mb          MB        Disk usage
  token_cost_usd         USD       Cost per operation
```

### 17.2 Telemetry Metrics (Time-Series)

```
Continuous metrics tracked over time:

  hwai_mission_total{status="success|partial|failed"}
  hwai_mission_duration_ms{mission_type}
  hwai_executive_decisions_total{executive,correct="true|false"}
  hwai_agent_tasks_total{status="created|running|completed|failed"}
  hwai_tool_calls_total{tool,status="success|failed|retry"}
  hwai_tool_latency_ms{tool}
  hwai_recovery_total{target,status="detected|attempted|succeeded"}
  hwai_memory_operations_total{operation,status="hit|miss"}
  hwai_memory_search_latency_ms
  hwai_hallucinations_total{severity}
  hwai_tokens_total{model,type="input|output"}
  hwai_cost_total{model,provider}
  hwai_latency_ms{phase="api|tool|memory|end-to-end"}
  hwai_context_size_tokens
  hwai_checkpoint_size_bytes
  hwai_session_turns_total
```

---

## 18. Summary

### Architecture Complete

- **14 evaluation subsystems** designed and specified
- **10 golden dataset categories** with 197 target cases
- **6 degradation detectors** for prompt regression
- **8 quality gates** with P0/P1/P2 priorities
- **12 performance benchmark scenarios**
- **9 chaos injection targets**
- **3 long session benchmarks** (100/500/1000 turns)
- **11 dimensions** of model benchmarking
- **28+ telemetry metrics** across all subsystems
- **Dashboard API** with 9 data endpoints
- **CI integration** with GitHub Check Runs + annotations

### Bootstrapping Path

```
397 debug dumps → Classifier → ~185 bootstrapped golden cases
                        ↓
            Manual review → verified golden cases
                        ↓
            Hand-crafted → missing category cases
                        ↓
            Baseline v0.1.0 → first evaluation run
```

### No Implementation In This Sprint

- Architecture specification only
- No code written
- No business features modified
- No existing systems changed
- Ready for Sprint -0.8a implementation

### Next Sprint Inputs

- `docs/sprint-0.8-ai-evaluation-platform.md` — this document
- Existing `lib/observability/engine.ts` — telemetry foundation
- Existing `jest.config.js` — test configuration
- Existing `.github/workflows/test.yml` — CI template
- 397 debug dumps in `data/debug/` — dataset bootstrapping
