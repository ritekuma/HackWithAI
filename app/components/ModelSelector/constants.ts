import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

export interface ModelOption {
  id: SelectedModel | string;
  label: string;
  description?: string;
  poweredBy?: string;
  thinking?: boolean;
  isManual?: boolean;
}

// ── Profile-based options ──
export const ASK_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "hwai-standard",
    label: "HackWithAI v2 Standard",
    description: "Reliable performance for everyday tasks",
    poweredBy:
      "DeepSeek V4 Pro · Gemini Flash for images & PDFs",
  },
  {
    id: "hwai-pro",
    label: "HackWithAI v2 Pro",
    description: "Superior performance for most assignments",
    poweredBy: "DeepSeek Chat + Claude Sonnet 4.6 for coding & architecture",
  },
  {
    id: "hwai-max",
    label: "HackWithAI v2 Max",
    description: "Maximum intelligence for complex work",
    poweredBy: "Claude Opus 4.6",
  },
  {
    id: "hwai-enterprise",
    label: "HackWithAI v2 Enterprise",
    description:
      "Enterprise-grade AI for advanced coding, architecture, offensive security, autonomous agents, and large-scale software engineering",
    poweredBy: "Hermes 405B + Qwen Coder 32B",
  },
];

export const AGENT_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "hwai-standard",
    label: "HackWithAI v2 Standard",
    description: "Reliable agent for everyday automation",
    poweredBy: "DeepSeek V4 Pro",
    thinking: true,
  },
  {
    id: "hwai-pro",
    label: "HackWithAI v2 Pro",
    description: "Superior performance for most assignments",
    poweredBy: "Claude Sonnet 4.6 for coding, architecture & review",
    thinking: true,
  },
  {
    id: "hwai-max",
    label: "HackWithAI v2 Max",
    description: "Maximum intelligence for complex work",
    poweredBy: "Claude Opus 4.6",
    thinking: true,
  },
  {
    id: "hwai-enterprise",
    label: "HackWithAI v2 Enterprise",
    description:
      "Enterprise-grade AI for advanced coding, architecture, offensive security, autonomous agents, and large-scale software engineering",
    poweredBy: "Hermes 405B + Qwen Coder 32B",
    thinking: true,
  },
];

// ── Unlocked manual model selection ──
export const MANUAL_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    description: "Reliable performance for everyday tasks",
    poweredBy: "OpenRouter",
    isManual: true,
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek Chat (V3)",
    description: "General reasoning and chat",
    poweredBy: "OpenRouter",
    isManual: true,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Superior coding, architecture, and review",
    poweredBy: "Anthropic via OpenRouter",
    isManual: true,
    thinking: true,
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Maximum intelligence for complex work",
    poweredBy: "Anthropic via OpenRouter",
    isManual: true,
    thinking: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast, large context window, vision capable",
    poweredBy: "Google via OpenRouter",
    isManual: true,
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Powerful reasoning with 1M context window",
    poweredBy: "Google via OpenRouter",
    isManual: true,
  },
  {
    id: "x-ai/grok-4",
    label: "Grok 4",
    description: "Vision fallback and alternative reasoning",
    poweredBy: "xAI via OpenRouter",
    isManual: true,
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-405b",
    label: "Hermes 3 405B",
    description: "Agent coordination, planning, architecture",
    poweredBy: "Nous Research via OpenRouter",
    isManual: true,
    thinking: true,
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    label: "Qwen Coder 32B",
    description: "Enterprise coding, terminal, reverse engineering",
    poweredBy: "Alibaba via OpenRouter",
    isManual: true,
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    description: "Long context reasoning",
    poweredBy: "Moonshot via OpenRouter",
    isManual: true,
  },
];

export const getDefaultModelForMode = (mode: ChatMode): SelectedModel => {
  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  return options[0].id as SelectedModel;
};
