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

type UploadReferenceInput = {
  sessionId?: string | undefined;
  uploadId?: string | undefined;
};

type ClipForgeMcpHandlers = {
  getTranscript(
    input: {
      regenerate: boolean;
    } & UploadReferenceInput,
  ): Promise<
    TranscriptResult & {
      sessionId?: string | undefined;
      uploadId: string;
    }
  >;
  renderClip(
    input: {
      clip: z.infer<typeof renderClipRequestSchema>["clip"];
    } & UploadReferenceInput,
  ): Promise<
    RenderResult & {
      sessionId?: string | undefined;
    }
  >;
};

const uploadReferenceInputSchema = {
  sessionId: z
    .string()
    .pipe(storageIdSchema)
    .optional()
    .describe(
      "The TrueForge session id. Prefer this so ClipForge can use the session's focused video.",
    ),
  uploadId: z
    .string()
    .pipe(storageIdSchema)
    .optional()
    .describe(
      "Optional ClipForge upload id for debugging. Prefer sessionId in normal chat use.",
    ),
};

const getTranscriptInputSchema = {
  ...uploadReferenceInputSchema,
  regenerate: z
    .boolean()
    .optional()
    .describe("Regenerate the transcript instead of returning a cached one."),
};

const renderClipInputSchema = {
  ...uploadReferenceInputSchema,
  clip: renderClipRequestSchema.shape.clip.describe(
    "Optional clip render plan. Omit to render a short smoke-test clip.",
  ),
};

function uploadReferenceSummary({
  sessionId,
  uploadId,
}: {
  sessionId?: string | undefined;
  uploadId: string;
}) {
  return {
    ...(sessionId ? { sessionId } : {}),
    uploadId,
  };
}

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

function compactRenderResult(render: RenderResult) {
  const { clip, ...renderMetadata } = render;

  return {
    ...renderMetadata,
    clip: {
      endSeconds: clip.endSeconds,
      id: clip.id,
      output: clip.output,
      startSeconds: clip.startSeconds,
      title: clip.title,
      uploadId: clip.uploadId,
    },
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
    async ({ regenerate = false, sessionId, uploadId }) => {
      const result = await handlers.getTranscript({
        regenerate,
        sessionId,
        uploadId,
      });

      return jsonToolResult(
        result.cached ? "Returned cached transcript." : "Generated transcript.",
        {
          cached: result.cached,
          transcript: result.transcript,
          ...uploadReferenceSummary(result),
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
    async ({ clip, sessionId, uploadId }) => {
      const render = await handlers.renderClip({ clip, sessionId, uploadId });
      const compactRender = compactRenderResult(render);

      return jsonToolResult("Rendered clip.", {
        render: compactRender,
        ...uploadReferenceSummary(compactRender),
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
