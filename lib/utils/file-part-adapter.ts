/**
 * AI SDK v6 compatible file part adapter.
 *
 * Image files → base64 data URL (JSON-safe, survives HTTP transport)
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

  // Image → base64 data URL stored as type: "image" (not "file").
  // AI SDK v6 convertToModelMessages converts file parts with url → data,
  // then OpenAI adapter double-encodes: data:{mime};base64,{already-prefixed-url}.
  // Using type: "image" bypasses this bug entirely.
  if (IMAGE_TYPES.includes(mediaType)) {
    const getDataUrl = async (blob: Blob): Promise<string | null> => {
      try {
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return `data:${mediaType};base64,${btoa(binary)}`;
      } catch { return null; }
    };

    if (uploadedFile.file instanceof File) {
      const dataUrl = await getDataUrl(uploadedFile.file);
      if (dataUrl) return { type: "image" as const, image: dataUrl, mediaType };
    }
    if (uploadedFile.url) {
      try {
        const res = await fetch(uploadedFile.url);
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataUrl = await getDataUrl(blob);
        if (dataUrl) return { type: "image" as const, image: dataUrl, mediaType };
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
