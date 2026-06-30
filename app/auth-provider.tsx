"use client";

import { ReactNode } from "react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth } from "convex/react";
import {
  getStoredChats,
  upsertStoredChat,
  getStoredMessages,
  appendStoredMessage,
  deleteStoredChat,
} from "@/lib/utils/client-storage";

class MockConvexClient {
  setAuth(_fetchToken: unknown, onChange: (value: boolean) => void) {
    onChange(true);
  }

  watchQuery(_query: unknown, args?: Record<string, unknown>) {
    const watch = {
      localQueryResult: () => {
        if (args && typeof args.id === "string" && args.id.length > 10) {
          const chats = getStoredChats();
          return chats.find((c) => c.id === args.id) ?? null;
        }
        if (args && args.paginationOpts) {
          const chats = getStoredChats();
          return { page: chats, isDone: true, continueCursor: "" };
        }
        return undefined;
      },
      onUpdate: () => () => {},
    };
    return watch;
  }

  watchPaginatedQuery(_query: unknown, args?: Record<string, unknown>) {
    const watch = {
      localQueryResult: () => {
        if (args && typeof args === "object" && "chatId" in args) {
          const msgs = getStoredMessages(args.chatId as string);
          return { page: msgs, isDone: true, continueCursor: "" };
        }
        const chats = getStoredChats();
        return { page: chats, isDone: true, continueCursor: "" };
      },
      onUpdate: () => () => {},
      loadMore: () => {},
      pageSize: 28,
    };
    return watch;
  }

  async mutation(_mutation: unknown, args?: Record<string, unknown>) {
    if (!args) return {};
    // Desktop sandbox bridge: return valid Centrifugo config from env vars
    if ("connectionName" in args && "osInfo" in args && !("id" in args) && !("chatId" in args)) {
      const wsUrl = typeof process !== "undefined" && process.env?.CENTRIFUGO_WS_URL || "ws://127.0.0.1:8000/connection/websocket";
      const connectionId = "desktop-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const centrifugoToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb2NhbC1kZXYtdXNlciIsImV4cCI6OTk5OTk5OTk5OX0.mock_signature";
      return { connectionId, centrifugoToken, centrifugoWsUrl: wsUrl };
    }
    // Desktop sandbox bridge: refresh token or disconnect
    if ("connectionId" in args && Object.keys(args).length === 1 && !("id" in args) && !("chatId" in args) && !("connectionName" in args) && !("fileId" in args)) {
      // Try to match mutation name to distinguish refresh from disconnect
      const mutName = String((_mutation as any)?.name || (_mutation as any)?._name || "");
      if (mutName.toLowerCase().includes("disconnect")) {
        return { success: true };
      }
      // Default: treat as refresh
      const centrifugoToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb2NhbC1kZXYtdXNlciIsImV4cCI6OTk5OTk5OTk5OX0.mock_refresh";
      return { ok: true, centrifugoToken };
    }
    if ("fileId" in args && typeof args.fileId === "string" && args.fileId.startsWith("local-") &&
        !("id" in args) && !("chatId" in args)) {
      fetch("/api/local-file/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: args.fileId }),
      }).catch(() => {});
      try {
        const raw = localStorage.getItem("hwai:local-files");
        if (raw) {
          const files = JSON.parse(raw);
          const filtered = files.filter((f: { fileId: string }) => f.fileId !== args!.fileId);
          localStorage.setItem("hwai:local-files", JSON.stringify(filtered));
        }
        localStorage.removeItem(`hwai:file:${args.fileId}`);
      } catch {}
      return {};
    }
    if ("id" in args && "title" in args && typeof args.id === "string") {
      upsertStoredChat({
        _id: args.id as string,
        id: args.id as string,
        title: (args.title as string) || "New Chat",
        update_time: Date.now(),
        user_id: args.userId as string | undefined,
      });
    }
    if ("chatId" in args && "role" in args && "parts" in args) {
      appendStoredMessage(args.chatId as string, {
        _id: (args.id as string) || "",
        id: (args.id as string) || "",
        chatId: args.chatId as string,
        role: (args.role as "system" | "user" | "assistant") || "user",
        parts: (args.parts as unknown[]) || [],
        content: args.content as string | undefined,
        update_time: Date.now(),
        model: args.model as string | undefined,
        mode: args.mode as string | undefined,
        finish_reason: args.finish_reason as string | undefined,
        usage: args.usage,
      });
    }
    if ("chatId" in args && typeof args.chatId === "string" &&
        !("role" in args) && !("title" in args) && !("id" in args)) {
      deleteStoredChat(args.chatId as string);
    }
    return {};
  }

  async action(_action: unknown, args?: Record<string, unknown>) {
    if (args && "fileId" in args && typeof args.fileId === "string" && args.fileId.startsWith("local-")) {
      return { url: `/api/local-file/${args.fileId}` };
    }
    if (args && "fileIds" in args && Array.isArray(args.fileIds)) {
      const urls: Record<string, string> = {};
      for (const fid of args.fileIds) {
        const f = fid as string;
        if (f.startsWith("local-")) {
          urls[f] = `/api/local-file/${f}`;
        }
      }
      return urls;
    }
    return {};
  }

  subscribeToConnectionState() {
    return () => {};
  }

  clearAuth() {}

  async close() {}

  get connectionState() {
    return { connectionCount: 0, isConnected: false };
  }
}

function useLocalAuthFallback() {
  return {
    isLoading: false,
    isAuthenticated: true,
    fetchAccessToken: async () => null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = new MockConvexClient() as any;

  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useLocalAuthFallback}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
