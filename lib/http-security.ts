export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestOrigin = new URL(request.url).origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();

  const allowedOrigins = new Set([requestOrigin]);
  if (forwardedProto && forwardedHost) allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  if (forwardedProto && host) allowedOrigins.add(`${forwardedProto}://${host}`);

  for (const value of [process.env.SITE_ORIGIN, process.env.SITE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!value) continue;
    try {
      allowedOrigins.add(new URL(value).origin);
    } catch {
      // Ignore malformed optional environment values.
    }
  }

  return allowedOrigins.has(origin);
}
