// ── Execution Core V4: Mission-Controlled Execution Loop ──
// Replaces AI SDK auto-continue with Mission Controller ownership.
// Streaming preserved. Every execution decision goes through the Mission.

import { streamText, type UIMessage, convertToModelMessages, tool } from "ai";
import { myProvider, type ModelName } from "@/lib/ai/providers";
import { MissionController, GoalValidator, ProgressScorer, MissionCritic } from "@/lib/mission/core";
import type { CriticAction } from "@/lib/mission/core";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Agent Execution Config ────────────────────────────────────────────
const MAX_REASONING_CYCLES = Number(process.env.HWAI_MAX_AGENT_STEPS || "0") || (process.env.LOCAL_ONLY_MODE === "true" ? Number.MAX_SAFE_INTEGER : 100);
const CRITIC_CHECK_INTERVAL = Number(process.env.MISSION_CRITIC_INTERVAL || "10");
const PROGRESS_INTERVAL = Number(process.env.MISSION_PROGRESS_INTERVAL || "5");

// ── Tools ─────────────────────────────────────────────────────────────
const localTools = {
  run_terminal_cmd: tool({
    description: "Execute a shell command on the local machine. Returns stdout, stderr, and exit code.",
    parameters: z.object({ command: z.string().describe("The shell command to execute"), timeout: z.number().optional().default(30000).describe("Timeout in milliseconds") }),
    execute: async (args) => {
      const { command, timeout } = (args as any) || {};
      if (!command) return { error: "Missing command parameter" };
      try { const o = execSync(command, { timeout: timeout || 30000, maxBuffer: 1024 * 1024, encoding: "utf-8", shell: "/bin/bash" }); return { stdout: o, stderr: "", exitCode: 0 }; }
      catch (e: any) {
        const so = e.stdout?.toString() || "";
        const se = e.stderr?.toString() || "";
        const ec = e.status != null ? e.status : (e.signal ? 128 + 1 : 1);
        return { stdout: so, stderr: se || `exit code ${ec}`, exitCode: ec, command };
      }
    },
  }),
  file_write: tool({
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: z.object({ path: z.string().describe("Absolute path to write the file to"), content: z.string().describe("Content to write to the file") }),
    execute: async (args) => {
      const { path: fp, content } = args as any;
      if (!fp) return { error: "Missing path parameter" };
      try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, content || "", { encoding: "utf-8" }); return { success: true, path: fp, bytes: Buffer.byteLength(content || "") }; }
      catch (e: any) { return { error: e.message, path: fp }; }
    },
  }),
  file_read: tool({
    description: "Read the contents of a file on the local filesystem.",
    parameters: z.object({ path: z.string().describe("Absolute path to the file to read"), maxBytes: z.number().optional().default(10240).describe("Maximum bytes to read") }),
    execute: async (args) => {
      const { path: fp, maxBytes } = (args as any) || {};
      if (!fp) return { error: "Missing path parameter" };
      try { const c = fs.readFileSync(fp, { encoding: "utf-8" }); const m = maxBytes || 10240; return { content: c.substring(0, m), path: fp, truncated: c.length > m, totalBytes: c.length }; }
      catch (e: any) { return { error: e.message, path: fp }; }
    },
  }),
};

// ── Mission-Controlled Execution ──────────────────────────────────────
export interface MissionExecutionResult {
  missionId: string;
  status: string;
  reasoningCycles: number;
  toolCalls: number;
  retries: number;
  finishReason: string;
  consensus: string;
  errors: string[];
}

export async function executeMissionControlled(
  description: string,
  modelKey: string = "model-standard-chat",
  onStream?: (text: string) => void,
): Promise<MissionExecutionResult> {
  const mission = MissionController.create(description.substring(0, 80), description, [description]);
  mission.start();
  const scorer = new ProgressScorer();
  const critic = new MissionCritic();
  const errors: string[] = [];

  const maxLabel = MAX_REASONING_CYCLES === Number.MAX_SAFE_INTEGER ? "unlimited" : String(MAX_REASONING_CYCLES);

  const messages: any[] = [{
    role: "user",
    parts: [{ type: "text", text: `=== HACKWITHAI MISSION ===\n\n${description}\n\nExecute this task using the available tools.` }],
  }];

  let reasoningCycles = 0;
  let toolCalls = 0;
  let retries = 0;

  mission.log("execution", `Starting mission-controlled loop, max cycles: ${maxLabel}`);
  console.info(`[MISSION] ${mission.getId()} started — max cycles: ${maxLabel}`);

  const modelInstance = myProvider.languageModel(modelKey || "model-standard-chat");

  // ── Main Execution Loop ──
  while (reasoningCycles < MAX_REASONING_CYCLES) {
    reasoningCycles++;
    const cycleLabel = `${reasoningCycles}/${maxLabel}`;

    console.info(`[MISSION STEP ${cycleLabel}] starting reasoning cycle`);
    mission.log("reasoning_start", `Cycle ${cycleLabel}`);

    let stepToolCalls = 0;
    let stepText = "";
    let stepFinishReason = "";

    try {
      const modelMessages = await convertToModelMessages(messages as UIMessage[]);
      const result = streamText({
        model: modelInstance,
        messages: modelMessages,
        maxOutputTokens: 8192,
        temperature: 0.6,
        tools: localTools,
        stopWhen: ({ steps }: { steps: any[] }) => steps.length >= 1 && (steps[steps.length - 1]?.text?.length || 0) > 0,
        onStepFinish: ({ text, toolCalls: tcs, toolResults, finishReason }) => {
          stepToolCalls = tcs?.length || 0;
          toolCalls += tcs?.length || 0;
          stepText = text || stepText;
          stepFinishReason = finishReason || stepFinishReason;
          for (const r of (toolResults || [])) {
            const err = (r as any)?.output?.error || (r as any)?.error || "";
            if (err && typeof err === "string" && err.includes("Missing")) retries++;
          }
        },
        onFinish: ({ text, finishReason }) => {
          stepText = text || stepText;
          stepFinishReason = finishReason || stepFinishReason;
        },
      });

      // Collect the full stream response
      const responseText = await result.text;
      stepText = responseText || stepText;
      stepFinishReason = stepFinishReason || (await result.finishReason) || "unknown";
    } catch (e: any) {
      errors.push(`Cycle ${reasoningCycles}: ${e.message}`);
      console.info(`[MISSION ERROR] ${e.message}`);
      break;
    }

    console.info(`[MISSION STEP ${cycleLabel}] finishReason=${stepFinishReason} toolCalls=${stepToolCalls} text=${stepText.length}B retries=${retries}`);

    // Phase 2: Goal Validation — only MissionController decides completion
    // Never trust model's finishReason alone
    const goalAction = GoalValidator.neverTrustFinishReason(mission.getId());
    if (goalAction !== "replan" && !stepToolCalls && stepText?.length > 20) {
      mission.complete();
      break;
    }
    if (goalAction === "replan") {
      console.info(`[MISSION] goals incomplete — continuing`);
      mission.log("goal_validation", "Goals incomplete — continuing execution");
      continue;
    }

    // Phase 3: Mission Critic
    if (reasoningCycles % CRITIC_CHECK_INTERVAL === 0) {
      const progress = scorer.calculate(mission.getId());
      const criticAction = critic.evaluate(mission.getId(), progress, stepToolCalls > 0 ? "tool" : "text", "", retries > 0);
      console.info(`[MISSION CRITIC] cycle=${reasoningCycles} action=${criticAction} progress=${progress.overall}%`);
      if (criticAction === "abort") { mission.fail("Critic abort"); break; }
      if (criticAction === "notify") console.info(`[MISSION CRITIC] issue detected — continuing`);
    }

    // Phase 4: Progress
    if (reasoningCycles % PROGRESS_INTERVAL === 0) {
      const p = scorer.calculate(mission.getId());
      mission.update({ progress: p.overall } as any);
    }

    // Phase 5: Retry storm abort
    if (retries >= 5) { mission.fail("Retry storm"); break; }
  }

  const finalStatus = mission.getStatus();
  mission.log("execution_end", `Completed: ${finalStatus}, ${reasoningCycles} cycles, ${toolCalls} tool calls`);

  return {
    missionId: mission.getId(),
    status: finalStatus,
    reasoningCycles,
    toolCalls,
    retries,
    finishReason: finalStatus === "completed" ? "mission_complete" : "mission_" + finalStatus,
    consensus: `Mission ${mission.getId()}: ${finalStatus}. ${reasoningCycles} cycles, ${toolCalls} tool calls.`,
    errors,
  };
}
