import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get("ayanote_locale")) {
    response.cookies.set("ayanote_locale", "ja", { path: "/" });
  }
  if (!request.cookies.get("ayanote_role")) {
    response.cookies.set("ayanote_role", "teacher", { path: "/" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
