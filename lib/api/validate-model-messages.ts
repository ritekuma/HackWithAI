// ── ModelMessage Schema Validator ──
// Validates messages before streamText() against AI SDK v6 schema.
// Dumps invalid payloads to disk for debugging.
// Returns { valid: bool, error: { index, message, expected, received } | null }

import fs from "fs";
import path from "path";

const VALID_ROLES = ["system", "user", "assistant", "tool"];
const DATA_DIR = path.join(process.cwd(), "data", "debug");

function dumpPath(filename: string): string {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  return path.join(DATA_DIR, filename);
}

interface ValidationError {
  index: number;
  role: string;
  error: string;
  snippet: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  messageCount: number;
}

function contentSnippet(msg: any, max = 100): string {
  if (typeof msg.content === "string") return msg.content.substring(0, max);
  if (Array.isArray(msg.content)) {
    return JSON.stringify(msg.content.map((p: any) => {
      if (p?.type === "text") return { type: "text", text: (p.text || "").substring(0, 40) };
      if (p?.type === "image") return { type: "image", image: typeof p.image === "string" ? p.image.substring(0, 30) + "..." : "[object]" };
      if (p?.type === "image_url") return { type: "image_url", url: (p.image_url?.url || "").substring(0, 30) + "..." };
      if (p?.type === "file") return { type: "file", mediaType: p.mediaType };
      return { type: p?.type || "unknown" };
    }));
  }
  return JSON.stringify(msg.content).substring(0, max);
}

export function validateModelMessages(
  messages: any[],
  context: { chatId: string; provider: string; model: string; mode: string },
): ValidationResult {
  const errors: ValidationError[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const ctx = () => ({ index: i, role: m?.role, id: context.chatId });

    // Rule 1: role must be valid
    if (!m || typeof m !== "object") {
      errors.push({ index: i, role: "undefined", error: "Message is null/undefined/not an object", snippet: String(m) });
      continue;
    }
    if (!VALID_ROLES.includes(m.role)) {
      errors.push({ index: i, role: m.role || "undefined", error: `Invalid role "${m.role}". Must be one of: ${VALID_ROLES.join(", ")}`, snippet: JSON.stringify(m).substring(0, 100) });
      continue;
    }

    // Rule 2: content must exist (except for tool-call-only assistant messages)
    if (m.role !== "tool" && m.content === undefined) {
      errors.push({ index: i, role: m.role, error: "content is undefined", snippet: JSON.stringify(Object.keys(m)) });
      continue;
    }
    if (m.role !== "tool" && m.content === null) {
      errors.push({ index: i, role: m.role, error: "content is null", snippet: JSON.stringify(Object.keys(m)) });
      continue;
    }

    // Rule 3: content must be string or array
    if (m.role !== "tool" && typeof m.content !== "string" && !Array.isArray(m.content)) {
      errors.push({
        index: i, role: m.role,
        error: `content type is ${typeof m.content} (expected string or ContentPart[])`,
        snippet: contentSnippet(m),
      });
      continue;
    }

    // Rule 4: if content is array, each part must be valid
    if (Array.isArray(m.content)) {
      for (let j = 0; j < m.content.length; j++) {
        const part = m.content[j];
        if (!part || typeof part !== "object") {
          errors.push({ index: i, role: m.role, error: `content[${j}] is not an object`, snippet: String(part) });
          continue;
        }
        if (!part.type) {
          errors.push({ index: i, role: m.role, error: `content[${j}] missing "type" field. Keys: ${JSON.stringify(Object.keys(part))}`, snippet: JSON.stringify(part).substring(0, 100) });
          continue;
        }
        if (part.type === "text" && typeof part.text !== "string") {
          errors.push({ index: i, role: m.role, error: `content[${j}] type=text but text is ${typeof part.text}`, snippet: JSON.stringify(part).substring(0, 100) });
        }
        if (part.type === "image" && !part.image && !part.url) {
          errors.push({ index: i, role: m.role, error: `content[${j}] type=image but no image/url field`, snippet: JSON.stringify(part).substring(0, 100) });
        }
        if (part.type === "image_url" && !part.image_url?.url && !part.url) {
          errors.push({ index: i, role: m.role, error: `content[${j}] type=image_url but no image_url.url`, snippet: JSON.stringify(part).substring(0, 100) });
        }
      }
    }
  }

  // Dump to file for debugging
  const dumpFile = dumpPath(`modelmessage-${context.chatId}-${Date.now()}.json`);
  try {
    fs.writeFileSync(dumpFile, JSON.stringify({
      context,
      messageCount: messages.length,
      errors: errors.length > 0 ? errors : null,
      messages: messages.map((m, i) => ({
        index: i,
        role: m?.role,
        content: typeof m?.content === "string"
          ? m.content.substring(0, 500)
          : Array.isArray(m?.content)
            ? m.content.map((p: any) => ({ type: p?.type, text: (p?.text || "").substring(0, 100), image: p?.image ? "[base64]" : undefined }))
            : m?.content,
      })),
    }, null, 2));
  } catch {}

  return { valid: errors.length === 0, errors, messageCount: messages.length };
}
