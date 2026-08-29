import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { renderClipRequestSchema, type ClipRenderPlan } from "./clip.js";
import { storageIdSchema } from "./storage-id.js";
import type { Transcript } from "./transcription.js";

type TranscriptResult = {
  cached: boolean;
  transcript: Transcript;
};

type RenderResult = {
  byteLength: number;
  clip: ClipRenderPlan;
  createdAt: string;
  id: string;
  mimeType: "video/mp4";
  publicUrl: string;
  uploadId: string;
  url: string;
};

type ClipForgeMcpHandlers = {
  getTranscript(input: {
    regenerate: boolean;
    uploadId: string;
  }): Promise<TranscriptResult>;
  renderClip(input: {
    clip: z.infer<typeof renderClipRequestSchema>["clip"];
    uploadId: string;
  }): Promise<RenderResult>;
};

const getTranscriptInputSchema = {
  regenerate: z
    .boolean()
    .optional()
    .describe("Regenerate the transcript instead of returning a cached one."),
  uploadId: z
    .string()
    .pipe(storageIdSchema)
    .describe("The ClipForge upload id returned by the media service."),
};

const renderClipInputSchema = {
  clip: renderClipRequestSchema.shape.clip.describe(
    "Optional clip render plan. Omit to render a short smoke-test clip.",
  ),
  uploadId: z
    .string()
    .pipe(storageIdSchema)
    .describe("The ClipForge upload id returned by the media service."),
};

function jsonToolResult(
  summary: string,
  structuredContent: Record<string, unknown>,
) {
  return {
    content: [
      {
        text: `${summary}\n\n${JSON.stringify(structuredContent, null, 2)}`,
        type: "text" as const,
      },
    ],
    structuredContent,
  };
}

export function createClipForgeMcpServer(handlers: ClipForgeMcpHandlers) {
  const server = new McpServer({
    name: "clipforge-media",
    version: "0.1.0",
  });

  server.registerTool(
    "get_transcript",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Return a timestamped transcript and caption segments for an uploaded video.",
      inputSchema: getTranscriptInputSchema,
      title: "Get Transcript",
    },
    async ({ regenerate = false, uploadId }) => {
      const result = await handlers.getTranscript({ regenerate, uploadId });

      return jsonToolResult(
        result.cached ? "Returned cached transcript." : "Generated transcript.",
        {
          cached: result.cached,
          transcript: result.transcript,
          uploadId,
        },
      );
    },
  );

  server.registerTool(
    "render_clip",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Render an uploaded video segment into a vertical MP4 using a ClipForge clip JSON shape.",
      inputSchema: renderClipInputSchema,
      title: "Render Clip",
    },
    async ({ clip, uploadId }) => {
      const render = await handlers.renderClip({ clip, uploadId });

      return jsonToolResult("Rendered clip.", {
        render,
      });
    },
  );

  return server;
}

export async function createClipForgeMcpConnection(
  handlers: ClipForgeMcpHandlers,
) {
  const server = createClipForgeMcpServer(handlers);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return {
    server,
    transport,
  };
}
