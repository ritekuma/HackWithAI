"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // ChunkLoadError: stale chunks after hot reload / new deploy.
    // Auto-refresh once to load the new chunk manifest.
    if (
      error.name === "ChunkLoadError" ||
      error.message?.includes("Failed to fetch dynamically imported module") ||
      error.message?.includes("Importing a module script failed") ||
      error.message?.includes("error loading dynamically imported module") ||
      error.message?.includes("Loading chunk") ||
      error.message?.includes("Failed to load chunk")
    ) {
      console.info("[RECOVERY] ChunkLoadError detected — reloading page to pick up new build");

      // Prevent infinite reload loops
      const reloadKey = "__hwai_chunk_reload";
      const reloadCount = parseInt(sessionStorage.getItem(reloadKey) || "0", 10);
      if (reloadCount < 3) {
        sessionStorage.setItem(reloadKey, String(reloadCount + 1));
        window.location.reload();
        return;
      }
      // After 3 attempts, show manual recovery
      sessionStorage.removeItem(reloadKey);
    }
  }, [error]);

  // Clean up the reload counter on successful load
  useEffect(() => {
    const key = "__hwai_chunk_reload";
    sessionStorage.removeItem(key);
  }, []);

  return (
    <html>
      <body style={{ background: "#0a0a0a", color: "#e0e0e0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100vh", padding: "2rem",
          textAlign: "center",
        }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Application Updated
          </h2>
          <p style={{ color: "#888", marginBottom: "1.5rem", maxWidth: "400px" }}>
            A new version of HackWithAI is available. Click below to load the latest version.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#6366f1", color: "white", border: "none",
              padding: "0.75rem 2rem", borderRadius: "0.5rem",
              fontSize: "0.875rem", fontWeight: 500, cursor: "pointer",
            }}
          >
            Reload Application
          </button>
          {error.digest && (
            <p style={{ color: "#555", fontSize: "0.75rem", marginTop: "1rem" }}>
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
