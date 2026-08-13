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

function eventApiUrl() {
  const explicit = runtimeValue("EVENT_API_URL");
  const base = eventApiBase();
  return explicit || (base ? `${base}/api/event` : "");
}

async function forwardJson(upstream: Response) {
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  if (!localHostEnabled(request)) {
    return Response.json({ error: "主持控制只在本地开放" }, { status: 403 });
  }
  const apiUrl = eventApiUrl();
  if (!apiUrl) return Response.json({ error: "本地主持端尚未连接公网活动" }, { status: 503 });
  const source = new URL(request.url);
  const upstream = await fetch(`${apiUrl}?${source.searchParams.toString()}`, { cache: "no-store" });
  return forwardJson(upstream);
}

export async function POST(request: Request) {
  if (!localHostEnabled(request)) {
    return Response.json({ error: "主持控制只在本地开放" }, { status: 403 });
  }

  const apiUrl = eventApiUrl();
  const hostKey = runtimeValue("HOST_KEY");
  if (!apiUrl || !hostKey) {
    return Response.json({ error: "本地主持端尚未连接公网活动" }, { status: 503 });
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const upstream = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, hostKey }),
  });
  return forwardJson(upstream);
}
