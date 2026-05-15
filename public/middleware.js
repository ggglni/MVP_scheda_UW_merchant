import { NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!_next).*)"],
};

export default function middleware(req) {
  const basicAuth = req.headers.get("authorization");
  const user = process.env.AUTH_USER || "admin";
  const pass = process.env.AUTH_PASS || "changeme";

  if (basicAuth) {
    const [scheme, encoded] = basicAuth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(":");
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Accesso non autorizzato", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Scheda UW Merchant"',
    },
  });
}
