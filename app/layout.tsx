import type { Metadata } from "next";
import "./globals.css";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { GlobalStateProvider } from "./contexts/GlobalState";
import { TodoBlockProvider } from "./contexts/TodoBlockContext";
import { DataStreamProvider } from "./components/DataStreamProvider";
import { LocalClientProvider } from "./local-client-provider";
import { AuthProvider } from "./auth-provider";
import { isLocalOnlyMode } from "@/lib/local-only";

const APP_NAME = "HackWithAI v2";
const APP_DEFAULT_TITLE =
  "HackWithAI v2 - AI-Powered Penetration Testing Assistant";
const APP_TITLE_TEMPLATE = "%s | HackWithAI v2";
const APP_DESCRIPTION =
  "HackWithAI v2 is an AI pentesting assistant that helps you scan targets, exploit vulnerabilities, analyze findings, and write reports faster.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: "%s",
  },
  description: APP_DESCRIPTION,
  keywords: [
    "hwai",
    "hack with ai",
    "penetration testing tool",
    "penetration testing ai",
    "pentesting ai",
    "pentest automation",
    "security assessment ai",
    "vulnerability scanner ai",
    "offensive security ai",
    "red team ai",
    "cybersecurity ai assistant",
    "bug bounty ai",
    "security ai",
    "kali linux",
    "local ai",
    "private ai",
  ],
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "HackWithAI v2",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "HackWithAI v2",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isLocal = isLocalOnlyMode();

  // In local-only mode, wrap with mock providers so the app works without
  // WorkOS and Convex backends.
  let content = (
    <GlobalStateProvider>
      <DataStreamProvider>
        <TodoBlockProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </TodoBlockProvider>
      </DataStreamProvider>
    </GlobalStateProvider>
  );

  if (isLocal) {
    content = <LocalClientProvider>{content}</LocalClientProvider>;
  } else {
    content = <AuthProvider>{content}</AuthProvider>;
  }

  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="48x48" />
      </head>
      <body className="antialiased h-full">
        {content}
      </body>
    </html>
  );
}
