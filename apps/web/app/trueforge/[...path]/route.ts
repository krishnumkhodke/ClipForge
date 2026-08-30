import type { NextRequest } from "next/server";

const TRUEFORGE_BASE_URL =
  process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";

const REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
];

const RESPONSE_HEADERS_TO_REMOVE = [
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
];
const AGENT_REGISTRY_MUTATION_METHODS = new Set([
  "DELETE",
  "PATCH",
  "POST",
  "PUT",
]);

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function isAgentRegistryMutation(method: string, path: string[]) {
  return (
    AGENT_REGISTRY_MUTATION_METHODS.has(method) &&
    path[0] === "api" &&
    path[1] === "v1" &&
    path[2] === "agents"
  );
}

async function proxyTrueForge(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;

  if (isAgentRegistryMutation(request.method, path)) {
    return Response.json(
      {
        error: "agent_registry_read_only",
        message: "Saved agents are read-only in the anonymous ClipForge demo.",
      },
      { status: 403 },
    );
  }

  const target = new URL(
    `${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    `${TRUEFORGE_BASE_URL.replace(/\/$/, "")}/`,
  );
  const headers = new Headers(request.headers);

  for (const name of REQUEST_HEADERS_TO_REMOVE) {
    headers.delete(name);
  }

  // Forward an uncompressed stream. Reusing an upstream gzip header after
  // fetch has decoded its body can make browsers report an incomplete response.
  headers.set("accept-encoding", "identity");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
    redirect: "manual",
    signal: request.signal,
  });
  const responseHeaders = new Headers(upstream.headers);

  for (const name of RESPONSE_HEADERS_TO_REMOVE) {
    responseHeaders.delete(name);
  }

  responseHeaders.set("cache-control", "no-cache, no-transform");
  responseHeaders.set("x-accel-buffering", "no");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export const GET = proxyTrueForge;
export const POST = proxyTrueForge;
export const PUT = proxyTrueForge;
export const PATCH = proxyTrueForge;
export const DELETE = proxyTrueForge;
export const OPTIONS = proxyTrueForge;
export const HEAD = proxyTrueForge;
