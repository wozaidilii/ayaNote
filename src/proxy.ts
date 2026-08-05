import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Public routes that do not require a signed session. */
const PUBLIC_PREFIXES = ["/", "/login", "/invite"];

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  if (pathname === "/login") return true;
  if (pathname.startsWith("/invite/")) return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get("ayanote_locale")) {
    response.cookies.set("ayanote_locale", "ja", { path: "/" });
  }
  // Do not invent a demo role cookie anymore.
  void PUBLIC_PREFIXES;
  void isPublicPath;
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
