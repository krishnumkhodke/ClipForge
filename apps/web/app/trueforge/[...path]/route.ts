import type { NextRequest } from "next/server";
import { CLIPFORGE_MODEL_NAME } from "../../clipforge-config";

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
const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function isAgentRegistryMutation(method: string, path: string[]) {
  return (
    MUTATION_METHODS.has(method) &&
    path[0] === "api" &&
    path[1] === "v1" &&
    path[2] === "agents"
  );
}

function isProtectedSettingsMutation(method: string, path: string[]) {
  return (
    MUTATION_METHODS.has(method) &&
    path[0] === "api" &&
    path[1] === "v1" &&
    path[2] === "settings" &&
    (path[3] === "model-providers" || path[3] === "mcp-servers")
  );
}

function isSessionSpecMutation(method: string, path: string[]) {
  return (
    MUTATION_METHODS.has(method) &&
    path[0] === "api" &&
    path[1] === "v1" &&
    path[2] === "sessions"
  );
}

function requestedModelName(body: ArrayBuffer) {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as {
      agent?: { spec?: { model?: { name?: unknown } } };
    };
    const name = value.agent?.spec?.model?.name;

    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
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

  if (isProtectedSettingsMutation(request.method, path)) {
    return Response.json(
      {
        error: "shared_settings_read_only",
        message:
          "Model providers and ClipForge connectors are read-only in the anonymous demo.",
      },
      { status: 403 },
    );
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const requestedModel =
    body && isSessionSpecMutation(request.method, path)
      ? requestedModelName(body)
      : undefined;

  if (requestedModel && requestedModel !== CLIPFORGE_MODEL_NAME) {
    return Response.json(
      {
        error: "model_not_allowed",
        message: `The anonymous ClipForge demo only allows ${CLIPFORGE_MODEL_NAME}.`,
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

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
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
