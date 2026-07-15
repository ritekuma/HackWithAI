// ── Conversation Fact Extractor ──
// Automatically extracts important facts from every conversation exchange
// and persists them into UnifiedMemoryRegistry for semantic retrieval.

import type { UIMessage } from "ai";
import { getMemory } from "./bootstrap";
import type { MemoryEntry } from "./types";

// ── Fact Classification ──────────────────────────────────────────────

export type FactCategory =
  | "user_preference"
  | "project"
  | "infrastructure"
  | "security"
  | "coding_decision"
  | "deployment"
  | "task"
  | "entity";

export interface ExtractedFact {
  content: string;
  category: FactCategory;
  confidence: number;
  sourceMsgId: string;
  sourceChatId: string;
}

// ── Classification Heuristics ────────────────────────────────────────

const CATEGORY_PATTERNS: [RegExp, FactCategory][] = [
  [/\b(prefer|like|use|favorite|IDE|theme|editor|setup|workflow|tool)\b/i, "user_preference"],
  [/\b(codename|project name|framework|version|release|sprint|milestone|repo|branch)\b/i, "project"],
  [/\b(database|cluster|node|server|region|zone|subnet|port|DNS|load.balancer|redis|postgres|mongo|k8s|kubernetes|docker|container|VM|instance)\b/i, "infrastructure"],
  [/\b(password|token|key|rotate|encrypt|hash|auth|OAuth|JWT|TLS|SSL|certificate|firewall|CVE|vulnerability|patch|exploit|scan|audit|policy|compliance)\b/i, "security"],
  [/\b(language|TypeScript|Python|Rust|Go|library|API|endpoint|function|class|module|import|export|interface|type|generic|async|promise)\b/i, "coding_decision"],
  [/\b(deploy|pipeline|CI.?CD|rollback|staging|production|release|AWS|GCP|Azure|e[uw]-.*\d|region|orchestrat|Istio|Helm|Terraform)\b/i, "deployment"],
  [/\b(task|scan|report|analyze|assess|test|audit|verify|check|run|execute|complete|finish|done)\b/i, "task"],
  [/\b(company|client|customer|team|organization|vendor|partner|service|tool)\b/i, "entity"],
];

// ── Extract Facts from Messages ──────────────────────────────────────

/**
 * Extracts important facts from a single message's text content.
 * Returns classified facts with confidence scores.
 */
export function extractFactsFromMessage(
  msg: UIMessage,
  chatId: string,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  if (!Array.isArray(msg.parts)) return facts;

  const textParts = msg.parts
    .filter((p: any) => p.type === "text" && (p as any).text?.trim())
    .map((p: any) => (p as any).text.trim());

  const combined = textParts.join(" ").trim();
  if (!combined || combined.length < 10) return facts;

  // Skip trivial system acknowledgments
  if (/^(got it|ok|acknowledged|noted|saved|proceed|continue|moving|let's move|proceeding)/i.test(combined)) {
    return facts;
  }

  // Extract fact-bearing sentences
  const sentences = combined.split(/[.!?]\s+/);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 15) continue;

    // Classify the sentence
    let bestCategory: FactCategory | null = null;
    let bestScore = 0;

    for (const [pattern, category] of CATEGORY_PATTERNS) {
      const matches = (trimmed.match(pattern) || []).length;
      if (matches > bestScore) {
        bestScore = matches;
        bestCategory = category;
      }
    }

    // Only keep facts with clear classification
    if (bestCategory && bestScore >= 1) {
      const confidence = Math.min(bestScore / 3, 1.0);

      // Skip facts that are just procedural noise
      if (trimmed.length < 30 && confidence < 0.5) continue;

      facts.push({
        content: trimmed,
        category: bestCategory,
        confidence,
        sourceMsgId: (msg as any).id || "",
        sourceChatId: chatId,
      });
    }
  }

  return facts;
}

// ── Store Facts in Memory ────────────────────────────────────────────

/**
 * Stores extracted conversation facts into UnifiedMemoryRegistry.
 * Each fact becomes a persistent memory entry with metadata.
 */
export async function storeConversationFacts(
  facts: ExtractedFact[],
  chatId: string,
): Promise<number> {
  if (facts.length === 0) return 0;

  const memory = getMemory();
  let stored = 0;

  for (const fact of facts) {
    const entry: MemoryEntry = {
      id: `conv-${chatId}-${Date.now()}-${stored}`,
      type: "conversation",
      content: fact.content,
      metadata: {
        category: fact.category,
        confidence: fact.confidence,
        sourceMsgId: fact.sourceMsgId,
        sourceChatId: fact.sourceChatId,
        chatId,
      },
      policy: "long_term",
      createdAt: Date.now(),
      accessedAt: Date.now(),
      priority: fact.confidence,
      tags: [fact.category, chatId],
    };

    await memory.store(entry);
    stored++;
  }

  return stored;
}

// ── Process Full Conversation ────────────────────────────────────────

/**
 * Processes all messages in a conversation and extracts facts from
 * the latest assistant response and user message.
 * Call this after each stream completion.
 */
export async function processConversationMemory(
  messages: UIMessage[],
  chatId: string,
): Promise<{ extracted: number; stored: number }> {
  const facts: ExtractedFact[] = [];

  // Process all messages to extract facts from the complete conversation
  for (const msg of messages) {
    const extracted = extractFactsFromMessage(msg, chatId);
    facts.push(...extracted);
  }

  const stored = await storeConversationFacts(facts, chatId);

  return { extracted: facts.length, stored };
}
