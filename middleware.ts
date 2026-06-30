import { authkit } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { isRateLimitError } from "@/lib/api/response";
import {
  REFERRAL_COOKIE_CREATED_AT_NAME,
  REFERRAL_COOKIE_NAME,
  getReferralRewardConfig,
  isValidReferralCode,
} from "@/lib/referrals/config";
import { isLocalOnlyMode } from "@/lib/local-only";
import { getPublicOrigin } from "@/lib/public-origin";

const UNAUTHENTICATED_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/signup/auth",
  "/logout",
  "/api/clear-auth-cookies",
  "/api/auth/desktop-callback",
  "/api/extra-usage/webhook",
  "/api/fraud/webhook",
  "/api/subscription/webhook",
  "/api/workos/webhook",
  "/api/auth/signup",
  "/callback",
  "/desktop-login",
  "/desktop-callback",
  "/auth-error",
  "/privacy-policy",
  "/terms-of-service",
  "/download",
  "/manifest.json",
]);

const DESKTOP_AUTH_HANDOFF_PATHS = new Set([
  "/desktop-login",
  "/desktop-callback",
  "/api/auth/desktop-callback",
]);

function getRedirectUri(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI) {
    return process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  }
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/callback`;
  }
  return `${getPublicOrigin(request.url)}/callback`;
}

function isDesktopApp(request: NextRequest): boolean {
  const userAgent = request.headers.get("user-agent") || "";
  return userAgent.includes("HackWithAI-Desktop");
}

function isUnauthenticatedPath(pathname: string): boolean {
  if (UNAUTHENTICATED_PATHS.has(pathname)) {
    return true;
  }
  if (pathname.startsWith("/share/")) {
    return true;
  }
  if (pathname.startsWith("/invite/")) {
    return true;
  }
  if (pathname.startsWith("/downloads/")) {
    return true;
  }
  return false;
}

function isBrowserRequest(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

const SESSION_HEADER = "x-workos-session";

function withReferralCookie(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const referralCode =
    request.nextUrl.searchParams.get("referral_code") ??
    request.nextUrl.searchParams.get("ref");
  if (!referralCode || !isValidReferralCode(referralCode)) return response;

  const config = getReferralRewardConfig();
  if (!config.enabled) return response;

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: config.cookieMaxAgeSeconds,
    path: "/",
  };

  response.cookies.set(REFERRAL_COOKIE_NAME, referralCode, cookieOptions);
  response.cookies.set(
    REFERRAL_COOKIE_CREATED_AT_NAME,
    String(Date.now()),
    cookieOptions,
  );

  return response;
}

export default async function middleware(
  request: NextRequest,
  _event: NextFetchEvent,
) {
  const pathname = request.nextUrl.pathname;

  if (isLocalOnlyMode() || !process.env.WORKOS_API_KEY) {
    return withReferralCookie(request, NextResponse.next());
  }

  // These routes run the desktop OAuth handoff. They must not pass through
  // AuthKit middleware, otherwise WorkOS redirects them through the normal web
  // /callback flow and the installed desktop app never receives its deep link.
  if (DESKTOP_AUTH_HANDOFF_PATHS.has(pathname)) {
    return withReferralCookie(request, NextResponse.next());
  }

  // Desktop app: redirect unauthenticated users to desktop-specific error page
  if (isDesktopApp(request)) {
    const hasSession = request.cookies.has("wos-session");

    if (!hasSession && !isUnauthenticatedPath(pathname)) {
      return withReferralCookie(
        request,
        NextResponse.redirect(
          new URL("/desktop-callback?error=unauthenticated", request.url),
        ),
      );
    }
  }

  let refreshHitRateLimit = false;
  const hadSessionCookie = request.cookies.has("wos-session");
  let session: Awaited<ReturnType<typeof authkit>>["session"];
  let headers: Awaited<ReturnType<typeof authkit>>["headers"];
  let authorizationUrl: Awaited<ReturnType<typeof authkit>>["authorizationUrl"];

  try {
    ({ session, headers, authorizationUrl } = await authkit(request, {
      redirectUri: getRedirectUri(request),
      eagerAuth: true,
      onSessionRefreshError: ({ error }) => {
        if (isRateLimitError(error)) {
          refreshHitRateLimit = true;
          console.warn(
            "[Auth Middleware] WorkOS rate limit hit during session refresh",
          );
        }
      },
    }));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "Unknown error");

    if (errorMessage.includes("Empty password")) {
      console.warn(
        "[Auth Middleware] WORKOS_COOKIE_PASSWORD is missing; falling back to unauthenticated mode.",
      );

      if (isUnauthenticatedPath(pathname)) {
        return withReferralCookie(request, NextResponse.next());
      }

      if (!isBrowserRequest(request)) {
        return withReferralCookie(
          request,
          NextResponse.json(
            {
              code: "auth_misconfigured",
              message:
                "Authentication is not configured. Set WORKOS_COOKIE_PASSWORD.",
            },
            { status: 503 },
          ),
        );
      }

      const errorUrl = new URL("/auth-error", request.url);
      errorUrl.searchParams.set("code", "503");
      return withReferralCookie(request, NextResponse.redirect(errorUrl));
    }

    throw error;
  }

  const requestHeaders = buildRequestHeaders(request, headers);
  const responseHeaders = buildResponseHeaders(headers);

  if (session.user || isUnauthenticatedPath(pathname)) {
    return withReferralCookie(
      request,
      NextResponse.next({
        request: { headers: requestHeaders },
        headers: responseHeaders,
      }),
    );
  }

  // If rate-limited (not a real session expiry), don't redirect to login
  if (hadSessionCookie && refreshHitRateLimit) {
    if (!isBrowserRequest(request)) {
      const rateLimitHeaders = new Headers(responseHeaders);
      rateLimitHeaders.set("Retry-After", "5");
      return withReferralCookie(
        request,
        NextResponse.json(
          { code: "rate_limited", message: "Please retry shortly." },
          { status: 503, headers: rateLimitHeaders },
        ),
      );
    }
    // For browser requests, let through rather than forcing a confusing login redirect
    return withReferralCookie(
      request,
      NextResponse.next({
        request: { headers: requestHeaders },
        headers: responseHeaders,
      }),
    );
  }

  if (!isBrowserRequest(request)) {
    return withReferralCookie(
      request,
      NextResponse.json(
        {
          code: "unauthorized:auth",
          message: "You need to sign in before continuing.",
          cause: "Session expired or invalid",
        },
        { status: 401, headers: responseHeaders },
      ),
    );
  }

  if (!authorizationUrl) {
    console.error("[Auth Middleware] authorizationUrl unavailable", {
      pathname,
      hasSession: !!session.user,
    });
    const errorUrl = new URL("/auth-error", request.url);
    errorUrl.searchParams.set("code", "503");
    return withReferralCookie(
      request,
      NextResponse.redirect(errorUrl, { headers: responseHeaders }),
    );
  }

  return withReferralCookie(
    request,
    NextResponse.redirect(authorizationUrl, { headers: responseHeaders }),
  );
}

function buildRequestHeaders(
  request: NextRequest,
  authkitHeaders: Headers,
): Headers {
  const merged = new Headers(request.headers);
  authkitHeaders.forEach((value, key) => {
    if (key.startsWith("x-")) {
      merged.set(key, value);
    }
  });
  return merged;
}

function buildResponseHeaders(authkitHeaders: Headers): Headers {
  const responseHeaders = new Headers(authkitHeaders);
  responseHeaders.delete(SESSION_HEADER);
  responseHeaders.delete("x-url");
  return responseHeaders;
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
