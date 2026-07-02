import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

export interface ModelOption {
  id: SelectedModel;
  label: string;
  /** Short tagline shown in the hover popup (e.g. "Maximum intelligence for complex work") */
  description?: string;
  /** "Powered by …" line shown beneath the description in the hover popup */
  poweredBy?: string;
  thinking?: boolean;
}

export const ASK_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "hwai-standard",
    label: "HackWithAI v2 Standard",
    description: "Reliable performance for everyday tasks",
    poweredBy:
      "DeepSeek V4 Flash · switches to Gemini 3 Flash for images & PDFs",
  },
  {
    id: "hwai-pro",
    label: "HackWithAI v2 Pro",
    description: "Superior performance for most assignments",
    poweredBy: "Claude Sonnet 4.6",
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
    poweredBy: "Moonshot Kimi K2.6",
    thinking: true,
  },
  {
    id: "hwai-pro",
    label: "HackWithAI v2 Pro",
    description: "Superior performance for most assignments",
    poweredBy: "Claude Sonnet 4.6",
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

export const getDefaultModelForMode = (mode: ChatMode): SelectedModel => {
  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  return options[0].id;
};
