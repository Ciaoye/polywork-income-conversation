import { env } from "cloudflare:workers";

function runtimeValue(key: string) {
  return String((env as unknown as Record<string, unknown>)[key] ?? "");
}

function localHostEnabled(request: Request) {
  const hostname = new URL(request.url).hostname;
  return runtimeValue("ENABLE_LOCAL_HOST") === "true"
    && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
}

function eventApiBase() {
  return runtimeValue("EVENT_API_BASE").replace(/\/$/, "");
}

export async function GET(request: Request) {
  if (!localHostEnabled(request)) {
    return Response.json({ error: "主持控制只在本地开放" }, { status: 403 });
  }
  const base = eventApiBase();
  if (!base) return Response.json({ error: "本地主持端尚未连接公网活动" }, { status: 503 });
  const source = new URL(request.url);
  const upstream = await fetch(`${base}/api/event?${source.searchParams.toString()}`, { cache: "no-store" });
  const data = (await upstream.json()) as Record<string, unknown>;
  return Response.json({ ...data, joinUrl: `${base}/join` }, { status: upstream.status });
}

export async function POST(request: Request) {
  if (!localHostEnabled(request)) {
    return Response.json({ error: "主持控制只在本地开放" }, { status: 403 });
  }

  const base = eventApiBase();
  const hostKey = runtimeValue("HOST_KEY");
  if (!base || !hostKey) {
    return Response.json({ error: "本地主持端尚未连接公网活动" }, { status: 503 });
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const upstream = await fetch(`${base}/api/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, hostKey }),
  });
  const data = (await upstream.json()) as Record<string, unknown>;
  return Response.json({ ...data, joinUrl: `${base}/join` }, { status: upstream.status });
}
