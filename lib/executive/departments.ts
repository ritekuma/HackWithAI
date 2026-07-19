// @module executive/departments v1.0.0 — Department registry and worker assignment

export interface Department {
  id: string;
  name: string;
  executiveRole: string;
  description: string;
  capabilities: string[];
  workers: Worker[];
}

export interface Worker {
  id: string;
  name: string;
  role: string;
  status: "idle" | "busy" | "offline";
  currentTask?: string;
  completedTasks: number;
  failedTasks: number;
  avgDurationMs: number;
  specialization: string[];
}

export interface Assignment {
  departmentId: string;
  workerId: string;
  task: string;
  reason: string;
  assignedAt: number;
}

const DEPARTMENTS: Department[] = [
  {
    id: "dept-strategy",
    name: "Strategy & Planning",
    executiveRole: "ceo",
    description: "Mission planning, goal decomposition, strategy formulation",
    capabilities: ["planning", "goal_decomposition", "strategy", "risk_assessment"],
    workers: [
      { id: "worker-planner-1", name: "Planner Alpha", role: "planner", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["mission_planning", "architecture"] },
      { id: "worker-planner-2", name: "Planner Beta", role: "planner", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["risk_analysis", "estimation"] },
    ],
  },
  {
    id: "dept-engineering",
    name: "Engineering",
    executiveRole: "cto",
    description: "Tool execution, code generation, system operations",
    capabilities: ["tool_execution", "coding", "debugging", "terminal", "browser"],
    workers: [
      { id: "worker-eng-1", name: "Engineer Alpha", role: "coder", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["typescript", "python", "bash"] },
      { id: "worker-eng-2", name: "Engineer Beta", role: "tool_operator", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["terminal", "browser", "filesystem"] },
    ],
  },
  {
    id: "dept-operations",
    name: "Operations",
    executiveRole: "coo",
    description: "Workflow orchestration, task coordination, resource management",
    capabilities: ["orchestration", "scheduling", "resource_management"],
    workers: [
      { id: "worker-ops-1", name: "Operator Alpha", role: "orchestrator", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["workflow", "scheduling"] },
    ],
  },
  {
    id: "dept-security",
    name: "Security",
    executiveRole: "cso",
    description: "Security review, threat detection, permission enforcement",
    capabilities: ["security_review", "threat_detection", "permission_validation"],
    workers: [
      { id: "worker-sec-1", name: "Security Reviewer", role: "reviewer", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["code_review", "permission_check"] },
    ],
  },
  {
    id: "dept-memory",
    name: "Memory & Knowledge",
    executiveRole: "cmo",
    description: "Memory operations, knowledge retrieval, pattern recognition",
    capabilities: ["memory_search", "memory_store", "pattern_recognition", "learning"],
    workers: [
      { id: "worker-mem-1", name: "Memory Worker", role: "retriever", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["knowledge_graph", "semantic_search"] },
    ],
  },
  {
    id: "dept-research",
    name: "Research",
    executiveRole: "cro",
    description: "Web research, data gathering, analysis",
    capabilities: ["web_search", "data_analysis", "research"],
    workers: [
      { id: "worker-res-1", name: "Researcher Alpha", role: "researcher", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["web_search", "analysis"] },
    ],
  },
  {
    id: "dept-infrastructure",
    name: "Infrastructure",
    executiveRole: "cio",
    description: "System health, deployment, configuration",
    capabilities: ["health_check", "deployment", "configuration", "monitoring"],
    workers: [
      { id: "worker-infra-1", name: "Infra Worker", role: "operator", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["health", "deployment"] },
    ],
  },
  {
    id: "dept-qa",
    name: "Quality Assurance",
    executiveRole: "cqa",
    description: "Verification, testing, evidence validation",
    capabilities: ["verification", "testing", "evidence_validation"],
    workers: [
      { id: "worker-qa-1", name: "QA Verifier", role: "verifier", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["code_verification", "evidence_check"] },
    ],
  },
  {
    id: "dept-recovery",
    name: "Recovery",
    executiveRole: "recovery",
    description: "Fault detection, recovery planning, rollback execution",
    capabilities: ["fault_detection", "recovery", "rollback", "checkpoint"],
    workers: [
      { id: "worker-rec-1", name: "Recovery Worker", role: "recovery_specialist", status: "idle", completedTasks: 0, failedTasks: 0, avgDurationMs: 0, specialization: ["checkpoint", "rollback"] },
    ],
  },
];

export function getDepartmentByRole(role: string): Department | undefined {
  return DEPARTMENTS.find(d => d.executiveRole === role || d.id.includes(role));
}

export function getAvailableWorker(departmentId: string): Worker | undefined {
  const dept = DEPARTMENTS.find(d => d.id === departmentId);
  if (!dept) return undefined;
  return dept.workers.find(w => w.status === "idle");
}

export function assignWorker(departmentId: string, task: string): Assignment | null {
  const dept = DEPARTMENTS.find(d => d.id === departmentId);
  if (!dept) return null;

  const worker = dept.workers.find(w => w.status === "idle");
  if (!worker) {
    // Try the other worker in the department
    const altWorker = dept.workers.find(w => w.status !== "offline");
    if (!altWorker) return null;

    altWorker.status = "busy";
    altWorker.currentTask = task;
    return {
      departmentId, workerId: altWorker.id, task,
      reason: `All idle workers busy — assigned to available ${altWorker.name}`,
      assignedAt: Date.now(),
    };
  }

  worker.status = "busy";
  worker.currentTask = task;
  return {
    departmentId, workerId: worker.id, task,
    reason: `Assigned to idle worker ${worker.name}`,
    assignedAt: Date.now(),
  };
}

export function completeWorkerTask(workerId: string, success: boolean, durationMs: number): void {
  for (const dept of DEPARTMENTS) {
    const worker = dept.workers.find(w => w.id === workerId);
    if (worker) {
      worker.status = "idle";
      worker.currentTask = undefined;
      if (success) {
        worker.completedTasks++;
        worker.avgDurationMs = worker.avgDurationMs
          ? (worker.avgDurationMs * (worker.completedTasks - 1) + durationMs) / worker.completedTasks
          : durationMs;
      } else {
        worker.failedTasks++;
      }
      return;
    }
  }
}

export function getDepartmentStats(): { id: string; name: string; idleWorkers: number; busyWorkers: number; completedTasks: number; failedTasks: number }[] {
  return DEPARTMENTS.map(d => ({
    id: d.id, name: d.name,
    idleWorkers: d.workers.filter(w => w.status === "idle").length,
    busyWorkers: d.workers.filter(w => w.status === "busy").length,
    completedTasks: d.workers.reduce((s, w) => s + w.completedTasks, 0),
    failedTasks: d.workers.reduce((s, w) => s + w.failedTasks, 0),
  }));
}

export function findDepartmentForCapability(capability: string): Department | undefined {
  return DEPARTMENTS.find(d => d.capabilities.includes(capability));
}

export function findDepartmentForTool(toolName: string): Department | undefined {
  const toolCapMap: Record<string, string> = {
    "run_terminal_cmd": "dept-engineering",
    "file_read": "dept-engineering",
    "file_write": "dept-engineering",
    "interact_terminal_session": "dept-engineering",
    "web_search": "dept-research",
    "memory_search": "dept-memory",
    "browser_navigate": "dept-engineering",
    "browser_screenshot": "dept-engineering",
  };
  const deptId = toolCapMap[toolName] || "dept-engineering";
  return DEPARTMENTS.find(d => d.id === deptId);
}
