// ── Tool Execution Standard ──
// Every tool returns a structured response. AI never guesses.
// Shared by chat-handler, orchestrator, and mission executor.

import { execSync } from "child_process";
import os from "os";
import fs from "fs";

// ── Standard Response Type ────────────────────────────────────────────
export interface ToolResponse {
  success: boolean;
  command: string;
  workingDirectory: string;
  environment: "local" | "docker" | "sandbox";
  shell: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  pid: number;
  toolName: string;
  toolVersion: string;
  missionId: string;
  executionId: string;
  stepId: string;
  reasoningCycle: number;
  artifacts: string[];
  network: { available: boolean; proxy: string; tor: boolean };
  resourceUsage: { cpuMs: number; memoryMb: number };
  exceptionType?: string;
  exceptionMessage?: string;
}

// ── Execution Context ─────────────────────────────────────────────────
let _execId = 0;
let _missionId = "default";
let _reasoningCycle = 0;

export function setMissionContext(id: string) { _missionId = id; }
export function nextReasoningCycle() { return ++_reasoningCycle; }
export function nextExecId() { return `exec-${Date.now()}-${++_execId}`; }

// ── Network Probe ─────────────────────────────────────────────────────
function probeNetwork(): { available: boolean; proxy: string; tor: boolean } {
  const proxy = process.env.HWAI_PROXY || process.env.http_proxy || "";
  let tor = false;
  try {
    const out = execSync("curl -s --max-time 3 --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip 2>/dev/null || echo '{}'", {
      timeout: 5000, encoding: "utf-8", shell: "/bin/bash",
    });
    tor = out.includes('"IsTor":true');
  } catch {}
  return { available: true, proxy, tor };
}

// ── Tool Executor Factory ─────────────────────────────────────────────
export function createToolExecutor(toolName: string, toolVersion = "1.0") {
  return function execute(
    command: string,
    opts?: { timeout?: number; cwd?: string; missionId?: string; stepId?: string; cycle?: number; env?: Record<string, string> }
  ): ToolResponse {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const cwd = opts?.cwd || process.cwd();
    const pid = process.pid;
    const execId = nextExecId();
    const cycle = opts?.cycle || _reasoningCycle;
    const network = probeNetwork();

    try {
      const output = execSync(command, {
        timeout: opts?.timeout || 30000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
        shell: "/bin/bash",
        cwd,
        env: opts?.env || process.env,
      });

      const artifacts = findNewFiles(cwd, startedMs);

      return {
        success: true,
        command,
        workingDirectory: cwd,
        environment: fs.existsSync("/.dockerenv") ? "docker" : fs.existsSync("/home/user") && !fs.existsSync("/home/kali") ? "sandbox" : "local",
        shell: "/bin/bash",
        stdout: output,
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedMs,
        startedAt,
        finishedAt: new Date().toISOString(),
        pid,
        toolName,
        toolVersion,
        missionId: opts?.missionId || _missionId,
        executionId: execId,
        stepId: opts?.stepId || execId,
        reasoningCycle: cycle,
        artifacts,
        network,
        resourceUsage: { cpuMs: 0, memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
      };
    } catch (e: any) {
      const stdout = e.stdout?.toString() || "";
      const stderr = e.stderr?.toString() || "";
      const exitCode = e.status != null ? e.status : (e.signal ? 128 + 1 : 1);
      const signal = e.signal || null;
      const timedOut = e.killed && signal === null; // execSync timeout

      // Classify the exception for the model
      const errType = e.code === "ENOENT" ? "CommandNotFound" :
        signal === "SIGTERM" ? "Terminated" :
        signal === "SIGKILL" ? "Killed" :
        timedOut ? "Timeout" :
        exitCode === 127 ? "CommandNotFound" :
        exitCode !== 0 ? "NonZeroExit" :
        "Unknown";

      return {
        success: false,
        command,
        workingDirectory: cwd,
        environment: fs.existsSync("/.dockerenv") ? "docker" : fs.existsSync("/home/user") && !fs.existsSync("/home/kali") ? "sandbox" : "local",
        shell: "/bin/bash",
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedMs,
        startedAt,
        finishedAt: new Date().toISOString(),
        pid,
        toolName,
        toolVersion,
        missionId: opts?.missionId || _missionId,
        executionId: execId,
        stepId: opts?.stepId || execId,
        reasoningCycle: cycle,
        artifacts: [],
        network,
        resourceUsage: { cpuMs: 0, memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
        exceptionType: errType,
        exceptionMessage: stderr || e.message || `exit code ${exitCode}`,
      };
    }
  };
}

// ── Helper: detect new/modified files ─────────────────────────────────
function findNewFiles(cwd: string, afterMs: number): string[] {
  const artifacts: string[] = [];
  try {
    const files = fs.readdirSync(cwd, { recursive: true, withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const fullPath = `${f.parentPath || cwd}/${f.name}`;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > afterMs && !fullPath.includes("node_modules") && !fullPath.includes(".next")) {
          artifacts.push(fullPath);
        }
      } catch {}
    }
  } catch {}
  return artifacts;
}

// ── Execution Journal ─────────────────────────────────────────────────
export function persistExecutionJournal(response: ToolResponse) {
  const dir = `${process.cwd()}/data`;
  fs.mkdirSync(dir, { recursive: true });
  const journalPath = `${dir}/execution_journal.jsonl`;
  fs.appendFileSync(journalPath, JSON.stringify(response) + "\n");
}

// ── Shell command wrappers for direct use ─────────────────────────────
export const runTerminal = createToolExecutor("run_terminal_cmd", "1.0");
export const runWrite = createToolExecutor("file_write", "1.0"); 
export const runRead = createToolExecutor("file_read", "1.0");
