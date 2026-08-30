import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  clipDurationSeconds,
  renderClipRequestSchema,
  type ClipRenderPlan,
} from "./clip.js";
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
      "The TrueForge session id for the chat. Use this by default so ClipForge operates on the session's focused video.",
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
    'Clip render plan. For one source range, use startSeconds and endSeconds. For multiple ranges, use segments in output order (maximum 8), where each segment has startSeconds, endSeconds, and optional transitionAfter. transitionAfter may be {"kind":"cut"} or {"kind":"card","preset":"chapter","durationSeconds":0.8,"title":"Next chapter"}; a card is only valid after a non-final segment. captions may be true to automatically include and remap transcript captions, false for none, or an explicit caption array. Also supports id, title, and output width, height, and fps. Unsupported today: custom caption style, font, color, crop mode, visual overlap transitions such as fades or wipes, music, B-roll, and thumbnails.',
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
      durationSeconds: clipDurationSeconds(clip),
      id: clip.id,
      output: clip.output,
      schemaVersion: clip.schemaVersion,
      segments: clip.segments,
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
        "Return a timestamped transcript and caption segments for the focused uploaded video. Prefer sessionId over uploadId in normal chat use.",
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
        "Render one or more ordered ranges from the focused uploaded video into one MP4. Ranges can be joined by plain cuts or ClipForge's fixed chapter-card transition. The tool can choose timing, order, chapter-card title and duration, clip title, captions, width, height, and fps. It cannot customize subtitle styling, fonts, colors, crop strategy, visual overlap transitions, music, B-roll, or thumbnails.",
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
