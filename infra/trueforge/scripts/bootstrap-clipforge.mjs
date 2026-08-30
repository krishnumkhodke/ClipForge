const trueForgeBaseUrl = (
  process.env.TRUEFORGE_BOOTSTRAP_BASE_URL ?? "http://127.0.0.1:8791"
).replace(/\/$/, "");
const mediaServiceUrl =
  process.env.CLIPFORGE_MCP_URL ??
  "http://host.docker.internal:4000/mcp";
const openAiApiKey = process.env.OPENAI_API_KEY;

const MODEL = {
  model_id: "gpt-5.4-mini",
  name: "gpt-5-4-mini",
  properties: {
    context_length: 400000,
    max_output_tokens: 128000,
    reasoning_efforts: ["none", "low", "medium", "high", "xhigh"],
  },
};

async function request(path, init = {}) {
  const response = await fetch(`${trueForgeBaseUrl}${path}`, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`,
    );
  }

  return text ? JSON.parse(text) : undefined;
}

async function waitForTrueForge() {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      await request("/healthz");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(`TrueForge did not become healthy at ${trueForgeBaseUrl}`);
}

async function putManifest(path, manifest) {
  await request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
}

async function main() {
  if (!openAiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to configure the ClipForge demo model.",
    );
  }

  await waitForTrueForge();
  await putManifest("/api/v1/settings/mcp-servers", {
    type: "remote",
    name: "media_service",
    url: mediaServiceUrl,
    description:
      "Inspect, transcribe, and render the video focused in a ClipForge session.",
  });
  await putManifest("/api/v1/settings/model-providers", {
    type: "openai",
    auth: { api_key: openAiApiKey },
    models: [MODEL],
  });

  console.log(
    `ClipForge configured media_service (${mediaServiceUrl}) and openai/${MODEL.name}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
