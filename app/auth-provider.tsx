"use client";

import { ReactNode, useEffect, useRef } from "react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth } from "convex/react";
import { getStorageInitPromise } from "@/lib/utils/client-storage";
import { MockConvexClient } from "@/lib/mock-convex-client";

function useLocalAuthFallback() {
  return {
    isLoading: false,
    isAuthenticated: true,
    fetchAccessToken: async () => null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<MockConvexClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new MockConvexClient();
  }
  const client = clientRef.current as any;

  useEffect(() => {
    const p = getStorageInitPromise();
    if (p) {
      p.then(() => {
        clientRef.current?.notifyAll();
      });
    }
  }, []);

  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useLocalAuthFallback}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
