// ── Context Builder ──
// Assembles the model context from:
//   1. System Prompt (IDENTITY block)
//   2. Retrieved Memories (from UnifiedMemoryRegistry)
//   3. Knowledge Entities (project structure, tools, agents)
//   4. Recent Conversation Window (last N messages)
//   5. Current User Request
//
// Older messages beyond the window are replaced by memory/summaries,
// preventing unbounded context growth.

import type { UIMessage } from "ai";
import type { ChatMode, SelectedModel } from "@/types/chat";
import { getMemory } from "@/lib/memory";
import type { MemoryEntry, KnowledgeEntity } from "@/lib/memory";
import { getRelevantMemories } from "@/lib/memory/user-memory";

// ── Constants ──────────────────────────────────────────────────────

/** Maximum raw conversation messages to include in context */
const RECENT_MESSAGE_WINDOW = 12;

/** Maximum memory entries to retrieve */
const MAX_MEMORY_ENTRIES = 10;

/** Maximum knowledge entities to include */
const MAX_KNOWLEDGE_ENTITIES = 8;

/** Maximum characters per memory entry in context */
const MAX_MEMORY_CONTENT_CHARS = 500;

// ── Phase 1.2 Validation: always log compact block ──────────────────
function vlog(msg: string) { console.error(`[V12] ${msg}`); }

// ── Forensic Instrumentation ────────────────────────────────────────
// Logs exact context reaching the model for Phase 1.1 validation.
// Set FORENSIC=true env var to enable. Remove after validation.

const FORENSIC = process.env.FMTX_ENABLED === "true" || process.env.FORENSIC_CONTEXT === "true";

function fmtx(msg: string, data?: unknown) {
  if (!FORENSIC) return;
  if (data !== undefined) {
    const s = typeof data === "string" ? data : JSON.stringify(data).substring(0, 500);
    console.error(`[FMTX] ${msg}`, s);
  } else {
    console.error(`[FMTX] ${msg}`);
  }
}
// ── End Forensic ─────────────────────────────────────────────────────

export interface MemoryContext {
  relevantMemories: string[];
  knowledgeContext: string[];
  conversationSummary: string | null;
}

export interface BuiltContext {
  /** The identity block that gets prepended to the first user message */
  identityBlock: string;
  /** The memory+knowledge context block (only in agent mode) */
  memoryContext: MemoryContext | null;
  /** The messages to actually send — recent window only */
  messages: UIMessage[];
  /** Whether messages were truncated */
  wasTruncated: boolean;
  /** How many older messages were replaced by memory */
  truncatedCount: number;
}

// ── Memory Retrieval ────────────────────────────────────────────────

/**
 * Retrieves relevant context from the memory system based on the
 * current conversation content. Uses text matching against
 * experiences and knowledge entities.
 */
async function retrieveMemory(
  recentText: string,
  maxEntries: number = MAX_MEMORY_ENTRIES,
): Promise<{
  memories: MemoryEntry[];
  knowledge: KnowledgeEntity[];
}> {
  try {
    const memory = getMemory();

    const searchResults = await memory.search(recentText, undefined, maxEntries);

    const memories = searchResults.map((r) => r.entry);

    const knowledge = memory
      .getEntities()
      .slice(0, MAX_KNOWLEDGE_ENTITIES);

    return { memories, knowledge };
  } catch {
    return { memories: [], knowledge: [] };
  }
}

// ── Memory Formatting ───────────────────────────────────────────────

/**
 * Formats retrieved memories into a concise textual block for the model.
 */
function formatMemoryBlock(
  memories: MemoryEntry[],
  knowledge: KnowledgeEntity[],
): { memoryBlock: string; knowledgeLines: string[] } {
  const memoryLines: string[] = [];

  if (memories.length > 0) {
    memoryLines.push("[RELEVANT MEMORIES — retrieved from experience store]");
    for (const m of memories) {
      const content = m.content.length > MAX_MEMORY_CONTENT_CHARS
        ? m.content.slice(0, MAX_MEMORY_CONTENT_CHARS) + "..."
        : m.content;
      const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
      memoryLines.push(`- ${m.type}/${m.id}: ${content}${tags}`);
    }
    memoryLines.push("");
  }

  const knowledgeLines: string[] = [];
  if (knowledge.length > 0) {
    knowledgeLines.push("[PROJECT KNOWLEDGE]");
    for (const k of knowledge) {
      const props = Object.entries(k.properties)
        .map(([k2, v]) => `${k2}=${v}`)
        .join(", ");
      knowledgeLines.push(`- ${k.type}/${k.name}: ${props}`);
    }
  }

  return {
    memoryBlock: memoryLines.join("\n"),
    knowledgeLines,
  };
}

// ── Conversation Extraction ─────────────────────────────────────────

/**
 * Builds a compact representation of the truncated (dropped) messages.
 * Extracts key facts from user messages and brief assistant responses
 * to provide the model with older conversation context without sending
 * the full message history.
 *
 * This is NOT a new memory system — it's a compact text representation
 * of the conversation history that was already in-memory but exceeded
 * the recent window. Same data, compact format.
 */
function extractConversationCompact(
  truncatedMessages: UIMessage[],
  maxChars: number = 3000,
): string | null {
  if (truncatedMessages.length === 0) return null;

  const lines: string[] = [];
  lines.push("[EARLIER CONVERSATION — compact]");

  let totalChars = 0;
  let factCount = 0;

  for (const msg of truncatedMessages) {
    if (totalChars > maxChars) {
      lines.push(`... (${truncatedMessages.length - factCount} more messages omitted)`);
      break;
    }

    if (!Array.isArray(msg.parts)) continue;

    const textParts = msg.parts
      .filter((p: any) => p.type === "text" && (p as any).text?.trim())
      .map((p: any) => (p as any).text.trim());

    if (textParts.length === 0) continue;

    const combined = textParts.join(" ");

    // Only include substantive messages (skip trivial ones like "Continue", "Proceed")
    const isSubstantive =
      combined.length > 20 ||
      combined.toLowerCase().includes("remember this fact") ||
      combined.toLowerCase().includes("fact:") ||
      combined.toLowerCase().includes("important:") ||
      combined.toLowerCase().includes("note:") ||
      combined.toLowerCase().includes("codename") ||
      combined.toLowerCase().includes("secret") ||
      combined.toLowerCase().includes("favorite") ||
      combined.toLowerCase().includes("capital") ||
      combined.toLowerCase().includes("speed of light");

    if (!isSubstantive) continue;

    const label = msg.role === "user" ? "User" : "Assistant";
    const truncated = combined.length > 200
      ? combined.substring(0, 197) + "..."
      : combined;

    lines.push(`- ${label}: ${truncated}`);
    totalChars += truncated.length;
    factCount++;
  }

  if (lines.length === 1) return null; // only header, no content

  // Add a note about what this is
  lines.push("");
  lines.push("[END EARLIER CONVERSATION]");
  lines.push("The above is compact context from earlier in this conversation. The recent messages follow below.");
  lines.push("");

  return lines.join("\n");
}

// ── Context Assembly ────────────────────────────────────────────────

/**
 * Assembles the complete context for a model request.
 *
 * BEFORE: All messages sent raw → unbounded token growth
 * AFTER:  System prompt + retrieved conversation memories + recent window only
 *
 * Conversation memories are persisted automatically via
 * processConversationMemory() after each stream completion.
 * This function retrieves the most semantically relevant memories
 * based on the current user query and recent conversation context.
 */
export async function buildContext(options: {
  messages: UIMessage[];
  mode: ChatMode;
  selectedModel: SelectedModel;
  systemPrompt: string;
  sysCtx: Record<string, unknown> | null;
  providerMode: string;
}): Promise<BuiltContext> {
  const { messages, mode, selectedModel, systemPrompt, sysCtx, providerMode } = options;

  const isAgentMode = mode === "agent";
  const windowSize = RECENT_MESSAGE_WINDOW;

  fmtx(`buildContext START: totalMsgs=${messages.length} mode=${mode} window=${windowSize}`);

  // Split: recent window vs older messages
  const recentMessages = messages.length > windowSize
    ? messages.slice(-windowSize)
    : messages;
  const truncatedCount = Math.max(0, messages.length - windowSize);

  if (truncatedCount > 0) {
    const oldestKept = recentMessages[0];
    const oldestKeptId = (oldestKept as any)?.id?.substring(0, 8) || "?";
    const oldestText = oldestKept?.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => (p.text || "").substring(0, 50))
      .join(" | ") || "(no text)";
    fmtx(`TRUNCATED: dropped ${truncatedCount} messages, keeping ${recentMessages.length}. Oldest kept: id=${oldestKeptId} role=${oldestKept?.role} text="${oldestText}"`);
  }

  // Build identity block
  const identityBlock = isAgentMode
    ? `${systemPrompt}\n\n=== HACKWITHAI IDENTITY ===\nSystem: HackWithAI v2 | Provider: ${providerMode} | Model: ${sysCtx?.currentModelSlug || "auto"} | Tier: ${selectedModel} | Mode: ${mode}\n=== END IDENTITY ===\n\n`
    : `=== HackWithAI v2 — Local Dev Mode (${providerMode}) ===\n\n`;

  // ── Semantic Memory Retrieval ──────────────────────────────────
  // Always search conversation memories — even when messages fit
  // within the window, Redis may contain facts from earlier exchanges.
  let memoryContext: MemoryContext | null = null;

  // ── User Memory (long-term, cross-chat facts) ──────────────────
  const userMemFacts = getRelevantMemories(searchQuery);

  // Build a search query from the messages
  const searchQuery = messages
    .map((m) => {
      if (!Array.isArray(m.parts)) return "";
      return m.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => (p.text || ""))
        .join(" ");
    })
    .join(" ")
    .substring(0, 800);

  // Search conversation memories from UnifiedMemoryRegistry
  let convMemories: MemoryEntry[] = [];
  try {
    const memory = getMemory();
    convMemories = await memory.searchConversations(searchQuery, 15);
    fmtx(`CONV-MEMORY-RESULTS: ${convMemories.length} entries`);
  } catch (e) {
    fmtx(`CONV-MEMORY-ERROR: ${(e as Error).message}`);
  }

  // Search existing experience/knowledge stores
  const { memories: expMemories, knowledge } = await retrieveMemory(searchQuery);

  // Format retrieved memories for the model
  const memoryLines: string[] = [];

  if (convMemories.length > 0) {
    memoryLines.push("[RETRIEVED CONVERSATION MEMORIES]");
    for (const m of convMemories.slice(0, 10)) {
      const category = (m.metadata?.category as string) || "unknown";
      memoryLines.push(`- [${category}] ${m.content}`);
    }
    memoryLines.push("");
  }

  if (expMemories.length > 0) {
    memoryLines.push("[RELATED EXPERIENCES]");
    for (const m of expMemories.slice(0, 5)) {
      memoryLines.push(`- ${m.content.substring(0, 300)}`);
    }
    memoryLines.push("");
  }

  const knowledgeLines: string[] = [];
  if (knowledge.length > 0) {
    knowledgeLines.push("[PROJECT KNOWLEDGE]");
    for (const k of knowledge.slice(0, 5)) {
      const props = Object.entries(k.properties)
        .map(([k2, v]) => `${k2}=${v}`)
        .join(", ");
      knowledgeLines.push(`- ${k.type}/${k.name}: ${props}`);
    }
  }

  memoryContext = {
    relevantMemories: [
      ...(userMemFacts.length > 0 ? [userMemFacts.join("\n")] : []),
      ...(memoryLines.length > 0 ? [memoryLines.join("\n")] : []),
    ],
    knowledgeContext: knowledgeLines,
    conversationSummary: null,
  };

  if (truncatedCount > 0) {
    fmtx(`TRUNCATED: dropped ${truncatedCount} messages, keeping ${recentMessages.length}`);
  } else {
    fmtx(`MEMORY: all ${messages.length} msgs within window`);
  }

  // Estimate token counts
  const estimateChars = (arr: any[]) =>
    arr.reduce((s: number, m: any) =>
      s + (Array.isArray(m.parts)
        ? m.parts.reduce((t: number, p: any) =>
            t + (p.text ? p.text.length : JSON.stringify(p).length), 0)
        : 0), 0);

  const identityChars = identityBlock.length;
  const memoryChars = memoryContext?.relevantMemories?.join("").length || 0;
  const msgChars = estimateChars(recentMessages);
  const totalChars = identityChars + memoryChars + msgChars;
  const estTokens = Math.ceil(totalChars / 4);

  fmtx(`SIZE: identity=${identityChars}c memory=${memoryChars}c msgs=${msgChars}c total=${totalChars}c ~${estTokens} tokens (${recentMessages.length} msgs)`);

  return {
    identityBlock,
    memoryContext,
    messages: recentMessages,
    wasTruncated: truncatedCount > 0,
    truncatedCount,
  };
}

// ── Helper: Inject context into messages ────────────────────────────

/**
 * Injects the identity block and memory context into the first user
 * message. This preserves OpenRouter prefix-matching cache behavior
 * while still providing full context to the model.
 *
 * Returns the updated messages array ready for convertToModelMessages().
 */
export function injectContextIntoMessages(
  messages: UIMessage[],
  identityBlock: string,
  memoryContext: MemoryContext | null,
): UIMessage[] {
  if (messages.length === 0) return messages;

  // Find the first user message to prepend context to.
  // The recent window may start with an assistant message.
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return messages;

  const firstMsg = messages[firstUserIdx];
  if (!Array.isArray(firstMsg.parts)) return messages;

  const textPart = firstMsg.parts.find((p: any) => p.type === "text");
  if (!textPart || !("text" in (textPart as any))) {
    return messages;
  }

  const originalText = (textPart as any).text;

  // Build the context prefix
  let prefix = identityBlock;

  if (memoryContext) {
    if (memoryContext.relevantMemories.length > 0) {
      prefix += memoryContext.relevantMemories.join("\n") + "\n";
    }
    if (memoryContext.knowledgeContext.length > 0) {
      prefix += memoryContext.knowledgeContext.join("\n") + "\n\n";
    }
  }

  const updatedMsg = {
    ...firstMsg,
    parts: [
      { type: "text" as const, text: `${prefix}${originalText}` },
      ...firstMsg.parts.filter((p: any) => p !== textPart),
    ],
  };

  fmtx(`INJECT: idx=${firstUserIdx} text="${((updatedMsg.parts[0] as any).text).substring(0, 400)}"`);

  const finalText = (updatedMsg.parts[0] as any).text;
  // Phase 1.2: dump compact block for inspection
  console.error("[V12-COMPACT] chars=" + finalText.length);
  console.error("[V12-BLOCK] " + finalText.substring(0, 3000));

  // Replace the message at firstUserIdx with the updated one
  const result = [...messages];
  result[firstUserIdx] = updatedMsg;
  return result;
}
