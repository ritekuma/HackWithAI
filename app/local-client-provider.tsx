"use client";

import { ReactNode, useRef } from "react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth } from "convex/react";
import { MockConvexClient } from "@/lib/mock-convex-client";

function useLocalAuth() {
  return {
    isLoading: false,
    isAuthenticated: true,
    fetchAccessToken: async () => null,
  };
}

export function LocalClientProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<MockConvexClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new MockConvexClient();
  }
  const client = clientRef.current as any;

  return (
    <AuthKitProvider
      initialAuth={{
        user: {
          id: "local-dev-user",
          email: "dev@hackwithai.local",
          firstName: "Local",
          lastName: "Dev",
        } as any,
        sessionId: "local-session",
        organizationId: "org_local",
        entitlements: ["pro-plan"],
      }}
      onSessionExpired={false}
    >
      <ConvexProviderWithAuth client={client} useAuth={useLocalAuth}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
