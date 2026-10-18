import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export default clerkMiddleware(async (auth, req) => {
  if (
    !process.env.CLERK_SECRET_KEY &&
    (
      req.nextUrl.pathname === "/api/test" ||
      req.nextUrl.pathname === "/api/live-metrics" ||
      req.nextUrl.pathname === "/api/logs/get-logs" ||
      req.nextUrl.pathname.startsWith("/api/v1/")
    )
  ) {
    return NextResponse.next();
  }
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.redirect("http://localhost:3000");
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
