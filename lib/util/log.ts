import { NextResponse } from "next/server";

/** Tiny structured logger for the server terminal. */
export function log(scope: string, msg: string, extra?: Record<string, unknown>) {
  const suffix = extra ? " " + JSON.stringify(extra) : "";
  console.log(`[${new Date().toISOString()}] [${scope}] ${msg}${suffix}`);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a route handler: logs route + latency, maps errors to JSON responses. */
export function withRoute<Ctx = unknown>(route: string, handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const start = Date.now();
    try {
      const res = await handler(req, ctx);
      log("route", `${route} ${res.status}`, { ms: Date.now() - start });
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      log("route", `${route} ${status} ERROR: ${message}`, { ms: Date.now() - start });
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}
