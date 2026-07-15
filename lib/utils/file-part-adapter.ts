/**
 * AI SDK v6 compatible file part adapter.
 *
 * Image files → native AI SDK file parts (Uint8Array data)
 * PDF files   → pdf-parse → text extraction → text parts
 * DOCX files  → mammoth → text extraction → text parts
 * TXT files   → File.text() → text parts
 * Other       → graceful fallback text note
 */
import type { UploadedFileState } from "@/types/file";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"];
const MAX_TEXT_SIZE = 50_000;

async function extractPDFText(buf: ArrayBuffer): Promise<string | null> {
  try {
    const pdfParse = await import("pdf-parse");
    const data = await pdfParse.default(Buffer.from(buf));
    return data.text || null;
  } catch { return null; }
}

async function extractDOCXText(buf: ArrayBuffer): Promise<string | null> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return result.value || null;
  } catch { return null; }
}

async function textPart(text: string, filename: string, mediaType: string) {
  return {
    type: "text" as const,
    text: `[File: ${filename} (${mediaType})]\n\n${text.substring(0, MAX_TEXT_SIZE)}`,
  };
}

export async function createAISDKFilePart(
  uploadedFile: UploadedFileState,
): Promise<any | null> {
  if (!uploadedFile.uploaded) return null;

  const mediaType = uploadedFile.file.type || "application/octet-stream";
  const filename = uploadedFile.file.name || "untitled";

  // Image → native AI SDK file part
  if (IMAGE_TYPES.includes(mediaType)) {
    if (uploadedFile.file instanceof File) {
      try {
        const buf = await uploadedFile.file.arrayBuffer();
        return { type: "file" as const, data: new Uint8Array(buf), filename, mediaType };
      } catch { return null; }
    }
    if (uploadedFile.url) {
      try {
        const res = await fetch(uploadedFile.url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return { type: "file" as const, data: new Uint8Array(buf), filename, mediaType };
      } catch { return null; }
    }
    return null;
  }

  // Get file buffer
  let buf: ArrayBuffer | null = null;
  if (uploadedFile.file instanceof File) {
    try { buf = await uploadedFile.file.arrayBuffer(); } catch { return null; }
  } else if (uploadedFile.url) {
    try { const res = await fetch(uploadedFile.url); if (res.ok) buf = await res.arrayBuffer(); } catch {}
  }
  if (!buf) return null;

  // PDF → pdf-parse
  if (mediaType === "application/pdf") {
    const text = await extractPDFText(buf);
    if (text) return textPart(text, filename, mediaType);
  }

  // DOCX → mammoth
  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.endsWith(".docx")) {
    const text = await extractDOCXText(buf);
    if (text) return textPart(text, filename, mediaType);
  }

  // TXT → File.text() (already handled above via buf, just decode)
  if (mediaType === "text/plain" || filename.endsWith(".txt")) {
    try {
      const text = new TextDecoder().decode(buf);
      if (text.trim()) return textPart(text, filename, mediaType);
    } catch {}
  }

  // Fallback
  return {
    type: "text" as const,
    text: `[File uploaded: ${filename} (${mediaType}, ${buf.byteLength} bytes)]. Binary content cannot be read directly.`,
  };
}
