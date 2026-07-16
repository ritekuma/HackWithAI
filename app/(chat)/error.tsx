"use client";

import { useEffect } from "react";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (
      error.name === "ChunkLoadError" ||
      error.message?.includes("Failed to fetch dynamically imported module") ||
      error.message?.includes("Loading chunk")
    ) {
      const key = "__hwai_chunk_reload";
      const count = parseInt(sessionStorage.getItem(key) || "0", 10);
      if (count < 3) {
        sessionStorage.setItem(key, String(count + 1));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "50vh", color: "#e0e0e0",
      fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "2rem",
    }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Loading updated application...</h2>
      <button
        onClick={reset}
        style={{
          background: "#6366f1", color: "white", border: "none",
          padding: "0.5rem 1.5rem", borderRadius: "0.5rem",
          fontSize: "0.875rem", cursor: "pointer", marginTop: "1rem",
        }}
      >
        Reload
      </button>
    </div>
  );
}
