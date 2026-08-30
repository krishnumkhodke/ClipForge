import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ClipSourceRangeError,
  mergeClipRenderPlan,
  renderClipRequestSchema,
  type ClipRenderPlanInput,
  type ClipRenderPlan,
} from "./clip.js";
import { createClipForgeMcpConnection } from "./mcp.js";
import {
  MediaProbeError,
  MediaProbeUnavailableError,
  probeVideoMetadata,
} from "./media-probe.js";
import { renderClipToFile } from "./rendering.js";
import {
  assertStorageId,
  InvalidStorageIdError,
  storageIdSchema,
} from "./storage-id.js";
import {
  AudioExtractionError,
  TranscriptionConfigurationError,
  TranscriptionProviderError,
  transcribeUpload,
  type Transcript,
  type UploadMetadata,
} from "./transcription.js";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  process.loadEnvFile(join(apiRoot, ".env"));
} catch (error) {
  if (!(
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )) {
    throw error;
  }
}

const dataRoot = process.env.MEDIA_DATA_DIR
  ? isAbsolute(process.env.MEDIA_DATA_DIR)
    ? process.env.MEDIA_DATA_DIR
    : resolve(apiRoot, process.env.MEDIA_DATA_DIR)
  : join(apiRoot, ".data");
const uploadRoot = join(dataRoot, "uploads");
const sessionRoot = join(dataRoot, "sessions");
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const internalMediaBaseUrl =
  process.env.MEDIA_INTERNAL_BASE_URL ?? `http://127.0.0.1:${port}`;
const publicMediaBaseUrl = (
  process.env.MEDIA_PUBLIC_BASE_URL ?? internalMediaBaseUrl
).replace(/\/+$/, "");
const defaultMaxUploadBytes = 1024 * 1024 * 1024;
const configuredMaxUploadBytes = Number(process.env.MEDIA_MAX_UPLOAD_BYTES);
const maxUploadBytes =
  Number.isFinite(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
    ? Math.floor(configuredMaxUploadBytes)
    : defaultMaxUploadBytes;
const defaultAllowedOrigins = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];
const allowedWebOrigins = new Set(
  (process.env.MEDIA_ALLOWED_ORIGINS?.split(",") ?? defaultAllowedOrigins)
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const videoFileExtensions = new Set([
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".ogg",
  ".ogv",
  ".webm",
]);

function isVideoUpload(filename: string, mimeType: string) {
  return (
    mimeType.startsWith("video/") ||
    videoFileExtensions.has(extname(filename).toLowerCase())
  );
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getUploadDirectory(uploadId: string) {
  return join(uploadRoot, assertStorageId(uploadId, "uploadId"));
}

function getUploadMetadataPath(uploadId: string) {
  return join(getUploadDirectory(uploadId), "metadata.json");
}

function getSessionDirectory(sessionId: string) {
  return join(sessionRoot, assertStorageId(sessionId, "sessionId"));
}

function getSessionUploadsIndexPath(sessionId: string) {
  return join(getSessionDirectory(sessionId), "uploads.json");
}

function getUploadTranscriptPath(uploadId: string) {
  return join(getUploadDirectory(uploadId), "transcript.json");
}

function getUploadRenderDirectory(uploadId: string, renderId: string) {
  return join(
    getUploadDirectory(uploadId),
    "renders",
    assertStorageId(renderId, "renderId"),
  );
}

function getUploadRenderClipPath(uploadId: string, renderId: string) {
  return join(getUploadRenderDirectory(uploadId, renderId), "clip.json");
}

function getUploadRenderOutputPath(uploadId: string, renderId: string) {
  return join(getUploadRenderDirectory(uploadId, renderId), "output.mp4");
}

async function readUploadMetadata(uploadId: string) {
  const contents = await readFile(
    getUploadMetadataPath(uploadId),
    "utf8",
  ).catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      throw new UploadNotFoundError(uploadId);
    }

    throw error;
  });

  const metadata = JSON.parse(contents) as UploadMetadata;

  if (metadata.video) {
    return metadata;
  }

  const backfilledMetadata = {
    ...metadata,
    video: await probeVideoMetadata(metadata.sourcePath),
  };

  await writeUploadMetadata(backfilledMetadata);

  return backfilledMetadata;
}

async function writeUploadMetadata(metadata: UploadMetadata) {
  const metadataPath = getUploadMetadataPath(metadata.id);
  const temporaryPath = `${metadataPath}.${nanoid()}.tmp`;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, metadataPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readSessionUploadIndex(
  sessionId: string,
): Promise<SessionUploadIndex> {
  const safeSessionId = assertStorageId(sessionId, "sessionId");

  try {
    const contents = await readFile(
      getSessionUploadsIndexPath(safeSessionId),
      "utf8",
    );

    return JSON.parse(contents) as SessionUploadIndex;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        focusedUploadId: null,
        sessionId: safeSessionId,
        uploads: [],
      };
    }

    throw error;
  }
}

async function writeSessionUploadIndex(index: SessionUploadIndex) {
  await mkdir(getSessionDirectory(index.sessionId), { recursive: true });
  await writeFile(
    getSessionUploadsIndexPath(index.sessionId),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

async function addUploadToSession(
  sessionId: string,
  uploadId: string,
  createdAt: string,
) {
  const index = await readSessionUploadIndex(sessionId);
  const uploads = index.uploads.some((upload) => upload.uploadId === uploadId)
    ? index.uploads
    : [...index.uploads, { createdAt, uploadId }];

  await writeSessionUploadIndex({
    ...index,
    focusedUploadId: uploadId,
    uploads,
  });
}

function toUploadResponse(metadata: UploadMetadata) {
  return {
    byteLength: metadata.byteLength,
    createdAt: metadata.createdAt,
    id: metadata.id,
    mimeType: metadata.mimeType,
    originalFilename: metadata.originalFilename,
    trueforgeSessionId: metadata.trueforgeSessionId,
    url: `/uploads/${metadata.id}/file`,
    video: metadata.video,
  };
}

function toVideoMetadataResponse(metadata: UploadMetadata) {
  if (!metadata.video) {
    throw new MediaProbeError("Video metadata is unavailable.");
  }

  return {
    byteLength: metadata.byteLength,
    createdAt: metadata.createdAt,
    filename: metadata.originalFilename,
    mimeType: metadata.mimeType,
    uploadId: metadata.id,
    ...metadata.video,
  };
}

async function readUploadTranscript(uploadId: string) {
  const contents = await readFile(getUploadTranscriptPath(uploadId), "utf8");

  return JSON.parse(contents) as Transcript;
}

async function readUploadTranscriptIfPresent(uploadId: string) {
  try {
    return await readUploadTranscript(uploadId);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readClipRenderPlan(uploadId: string, renderId: string) {
  const contents = await readFile(
    getUploadRenderClipPath(uploadId, renderId),
    "utf8",
  );

  return JSON.parse(contents) as ClipRenderPlan;
}

async function createOrReadTranscript(uploadId: string, regenerate: boolean) {
  const metadata = await readUploadMetadata(uploadId);

  if (!regenerate) {
    try {
      return {
        cached: true,
        transcript: await readUploadTranscript(uploadId),
      };
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }

      // Cache misses fall through to provider-backed transcription.
    }
  }

  const transcript = await transcribeUpload(
    metadata,
    getUploadDirectory(uploadId),
  );

  await writeFile(
    getUploadTranscriptPath(uploadId),
    `${JSON.stringify(transcript, null, 2)}\n`,
    "utf8",
  );

  return {
    cached: false,
    transcript,
  };
}

function parseRegenerateQuery(value: unknown) {
  return value === true || value === "true";
}

function sendTranscriptionError(reply: FastifyReply, error: unknown) {
  if (error instanceof TranscriptionConfigurationError) {
    return reply.code(503).send({
      error: "transcription_not_configured",
      message: error.message,
    });
  }

  if (error instanceof TranscriptionProviderError) {
    return reply.code(502).send({
      error: "transcription_failed",
      message: error.message,
    });
  }

  if (error instanceof AudioExtractionError) {
    return reply.code(422).send({
      error: "audio_extraction_failed",
      message: "Could not extract audio from this upload.",
    });
  }

  throw error;
}

function sendUploadNotFoundError(reply: FastifyReply) {
  return reply.code(404).send({
    error: "upload_not_found",
    message: "Upload not found.",
  });
}

function sendInvalidStorageIdError(
  reply: FastifyReply,
  error: InvalidStorageIdError,
) {
  return reply.code(400).send({
    error: "invalid_storage_id",
    field: error.field,
    message: error.message,
  });
}

const getTranscriptToolRequestSchema = z.object({
  regenerate: z.boolean().optional(),
  sessionId: storageIdSchema.optional(),
  uploadId: storageIdSchema.optional(),
});
const getVideoMetadataToolRequestSchema = z.object({
  sessionId: storageIdSchema.optional(),
  uploadId: storageIdSchema.optional(),
});
const renderClipToolRequestSchema = renderClipRequestSchema.extend({
  sessionId: storageIdSchema.optional(),
  uploadId: storageIdSchema.optional(),
});

type SessionUploadIndex = {
  focusedUploadId: string | null;
  sessionId: string;
  uploads: Array<{
    createdAt: string;
    uploadId: string;
  }>;
};

class RenderNotFoundError extends Error {
  constructor(renderId: string) {
    super(`Render ${renderId} was not found.`);
    this.name = "RenderNotFoundError";
  }
}

class UploadNotFoundError extends Error {
  constructor(uploadId: string) {
    super(`Upload ${uploadId} was not found.`);
    this.name = "UploadNotFoundError";
  }
}

class MissingUploadReferenceError extends Error {
  constructor() {
    super("Provide a sessionId or uploadId.");
    this.name = "MissingUploadReferenceError";
  }
}

class FocusedUploadNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} does not have a focused video.`);
    this.name = "FocusedUploadNotFoundError";
  }
}

function isFileNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function renderFileUrl(uploadId: string, renderId: string) {
  return `/uploads/${assertStorageId(uploadId, "uploadId")}/renders/${assertStorageId(renderId, "renderId")}/file`;
}

function absoluteMediaUrl(path: string) {
  return `${publicMediaBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function sourceFileUrl(uploadId: string) {
  return `${internalMediaBaseUrl}/uploads/${assertStorageId(uploadId, "uploadId")}/file`;
}

async function readRenderFileStats(uploadId: string, renderId: string) {
  return await stat(getUploadRenderOutputPath(uploadId, renderId)).catch(
    (error: unknown) => {
      if (isFileNotFoundError(error)) {
        throw new RenderNotFoundError(renderId);
      }

      throw error;
    },
  );
}

async function createUploadRender(
  uploadId: string,
  clipInput: ClipRenderPlanInput | undefined,
) {
  const metadata = await readUploadMetadata(uploadId);

  const transcript = await readUploadTranscriptIfPresent(uploadId);
  const clip = mergeClipRenderPlan(
    uploadId,
    clipInput,
    transcript,
    metadata.video,
  );
  const renderId = nanoid();
  const renderDirectory = getUploadRenderDirectory(uploadId, renderId);
  const outputPath = getUploadRenderOutputPath(uploadId, renderId);

  await mkdir(renderDirectory, { recursive: true });
  await writeFile(
    getUploadRenderClipPath(uploadId, renderId),
    `${JSON.stringify(clip, null, 2)}\n`,
    "utf8",
  );

  await renderClipToFile({
    bundleDirectory: dataRoot,
    clip,
    outputPath,
    sourceUrl: sourceFileUrl(uploadId),
  });

  const outputStats = await stat(outputPath);
  const url = renderFileUrl(uploadId, renderId);

  return {
    byteLength: outputStats.size,
    clip,
    createdAt: new Date().toISOString(),
    id: renderId,
    mimeType: "video/mp4" as const,
    publicUrl: absoluteMediaUrl(url),
    uploadId,
    url,
  };
}

async function resolveUploadId(input: {
  sessionId?: string | undefined;
  uploadId?: string | undefined;
}) {
  if (input.uploadId) {
    return assertStorageId(input.uploadId, "uploadId");
  }

  if (!input.sessionId) {
    throw new MissingUploadReferenceError();
  }

  const index = await readSessionUploadIndex(input.sessionId);

  if (!index.focusedUploadId) {
    throw new FocusedUploadNotFoundError(index.sessionId);
  }

  try {
    await readUploadMetadata(index.focusedUploadId);
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      throw new FocusedUploadNotFoundError(index.sessionId);
    }

    throw error;
  }

  return index.focusedUploadId;
}

function sendMissingUploadReferenceError(reply: FastifyReply) {
  return reply.code(400).send({
    error: "missing_upload_reference",
    message: "Provide a sessionId or uploadId.",
  });
}

function sendFocusedUploadNotFoundError(reply: FastifyReply) {
  return reply.code(404).send({
    error: "focused_upload_not_found",
    message: "This session does not have a focused video.",
  });
}

function sendSessionUploadResolutionError(reply: FastifyReply, error: unknown) {
  if (error instanceof InvalidStorageIdError) {
    return sendInvalidStorageIdError(reply, error);
  }

  if (error instanceof MissingUploadReferenceError) {
    return sendMissingUploadReferenceError(reply);
  }

  if (error instanceof FocusedUploadNotFoundError) {
    return sendFocusedUploadNotFoundError(reply);
  }

  return undefined;
}

function sendInvalidClipError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ClipSourceRangeError)) {
    return undefined;
  }

  return reply.code(400).send({
    error: "invalid_clip",
    message: error.message,
  });
}

function sendMediaProbeUnavailableError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof MediaProbeUnavailableError)) {
    return undefined;
  }

  return reply.code(503).send({
    error: "media_probe_unavailable",
    message: "Video inspection is temporarily unavailable. Try again.",
  });
}

const app = Fastify({
  logger: true,
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof InvalidStorageIdError) {
    return sendInvalidStorageIdError(reply, error);
  }

  const invalidClipResponse = sendInvalidClipError(reply, error);
  if (invalidClipResponse) {
    return invalidClipResponse;
  }

  const probeUnavailableResponse = sendMediaProbeUnavailableError(reply, error);
  if (probeUnavailableResponse) {
    return probeUnavailableResponse;
  }

  return reply.send(error);
});

const closeGracefully = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "Closing media API");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", closeGracefully);
process.once("SIGTERM", closeGracefully);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedWebOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
  },
});

await app.register(multipart, {
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
  },
  throwFileSizeLimit: false,
});

app.get("/health", async () => {
  return { ok: true, service: "clipforge-api" };
});

const clipForgeMcpHandlers = {
  getVideoMetadata: async ({ sessionId, uploadId }) => {
    const resolvedUploadId = await resolveUploadId({ sessionId, uploadId });
    const metadata = await readUploadMetadata(resolvedUploadId);

    return {
      metadata: toVideoMetadataResponse(metadata),
      ...(sessionId ? { sessionId } : {}),
      uploadId: resolvedUploadId,
    };
  },
  getTranscript: async ({ regenerate, sessionId, uploadId }) => {
    const resolvedUploadId = await resolveUploadId({ sessionId, uploadId });

    return {
      ...(await createOrReadTranscript(resolvedUploadId, regenerate)),
      ...(sessionId ? { sessionId } : {}),
      uploadId: resolvedUploadId,
    };
  },
  renderClip: async ({ clip, sessionId, uploadId }) => {
    const resolvedUploadId = await resolveUploadId({ sessionId, uploadId });

    return {
      ...(await createUploadRender(resolvedUploadId, clip)),
      ...(sessionId ? { sessionId } : {}),
    };
  },
} satisfies Parameters<typeof createClipForgeMcpConnection>[0];

app.all("/mcp", async (request, reply) => {
  const clipForgeMcp = await createClipForgeMcpConnection(clipForgeMcpHandlers);

  clipForgeMcp.transport.onerror = (error) => {
    request.log.error({ error }, "MCP transport error");
  };

  reply.hijack();

  try {
    await clipForgeMcp.transport.handleRequest(
      request.raw,
      reply.raw,
      request.body,
    );
  } catch (error) {
    request.log.error({ error }, "MCP request failed");

    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(
        JSON.stringify({
          error: "mcp_request_failed",
          message: "Could not handle MCP request.",
        }),
      );
    }
  } finally {
    await clipForgeMcp.server.close();
  }
});

async function storeUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  trueforgeSessionId?: string,
) {
  const upload = await request.file();

  if (!upload) {
    return reply.code(400).send({
      error: "missing_file",
      message: "Upload a video file.",
    });
  }

  if (!isVideoUpload(upload.filename, upload.mimetype)) {
    upload.file.resume();

    return reply.code(415).send({
      error: "unsupported_media_type",
      message: "Upload a video file such as MP4, MOV, or WebM.",
    });
  }

  const uploadId = nanoid();
  const uploadDirectory = getUploadDirectory(uploadId);
  const safeFilename = sanitizeFilename(upload.filename);
  const sourcePath = join(
    uploadDirectory,
    `source${extname(safeFilename) || ".video"}`,
  );

  await mkdir(uploadDirectory, { recursive: true });

  try {
    await pipeline(upload.file, createWriteStream(sourcePath));

    if (upload.file.truncated) {
      await rm(uploadDirectory, { force: true, recursive: true });

      return reply.code(413).send({
        error: "upload_too_large",
        message: "Videos must be 1 GB or smaller.",
      });
    }

    const fileStats = await stat(sourcePath);
    const video = await probeVideoMetadata(sourcePath);
    const metadata: UploadMetadata = {
      byteLength: fileStats.size,
      createdAt: new Date().toISOString(),
      id: uploadId,
      mimeType: upload.mimetype,
      originalFilename: safeFilename,
      sourcePath,
      ...(trueforgeSessionId ? { trueforgeSessionId } : {}),
      video,
    };

    await writeUploadMetadata(metadata);

    if (trueforgeSessionId) {
      await addUploadToSession(
        trueforgeSessionId,
        uploadId,
        metadata.createdAt,
      );
    }

    return reply.code(201).send({
      upload: toUploadResponse(metadata),
    });
  } catch (error) {
    await rm(uploadDirectory, { force: true, recursive: true });
    request.log.error({ error, uploadId }, "Failed to store upload");

    const probeUnavailableResponse = sendMediaProbeUnavailableError(
      reply,
      error,
    );
    if (probeUnavailableResponse) {
      return probeUnavailableResponse;
    }

    if (error instanceof MediaProbeError) {
      return reply.code(422).send({
        error: "invalid_video",
        message: error.message,
      });
    }

    throw error;
  }
}

app.post("/uploads", async (request, reply) => {
  return await storeUpload(request, reply);
});

app.post("/sessions/:sessionId/uploads", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };

  try {
    return await storeUpload(
      request,
      reply,
      assertStorageId(sessionId, "sessionId"),
    );
  } catch (error) {
    if (error instanceof InvalidStorageIdError) {
      return sendInvalidStorageIdError(reply, error);
    }

    throw error;
  }
});

app.get("/sessions/:sessionId/uploads", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };

  try {
    const index = await readSessionUploadIndex(sessionId);
    const uploads = [];

    for (const { uploadId } of index.uploads) {
      try {
        uploads.push(toUploadResponse(await readUploadMetadata(uploadId)));
      } catch (error) {
        if (error instanceof UploadNotFoundError) {
          request.log.warn(
            { sessionId: index.sessionId, uploadId },
            "Skipping missing session upload",
          );
          continue;
        }

        throw error;
      }
    }

    const availableUploadIds = new Set(uploads.map((upload) => upload.id));

    return {
      focusedUploadId:
        index.focusedUploadId && availableUploadIds.has(index.focusedUploadId)
          ? index.focusedUploadId
          : null,
      sessionId: index.sessionId,
      uploads,
    };
  } catch (error) {
    if (error instanceof InvalidStorageIdError) {
      return sendInvalidStorageIdError(reply, error);
    }

    throw error;
  }
});

app.get("/uploads/:uploadId", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };

  try {
    const metadata = await readUploadMetadata(uploadId);

    return {
      upload: toUploadResponse(metadata),
    };
  } catch (error) {
    if (error instanceof InvalidStorageIdError) {
      return sendInvalidStorageIdError(reply, error);
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    throw error;
  }
});

app.get("/uploads/:uploadId/file", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };

  try {
    const metadata = await readUploadMetadata(uploadId);

    return reply
      .type(metadata.mimeType)
      .header(
        "content-disposition",
        `inline; filename="${metadata.originalFilename}"`,
      )
      .send(createReadStream(metadata.sourcePath));
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    throw error;
  }
});

app.get("/uploads/:uploadId/transcript", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };

  try {
    await readUploadMetadata(uploadId);

    return {
      cached: true,
      transcript: await readUploadTranscript(uploadId),
    };
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    if (!isFileNotFoundError(error)) {
      throw error;
    }

    return reply.code(404).send({
      error: "transcript_not_found",
      message: "Transcript not found.",
    });
  }
});

app.post("/uploads/:uploadId/transcript", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };
  const { regenerate } = request.query as { regenerate?: unknown };

  try {
    return await createOrReadTranscript(
      uploadId,
      parseRegenerateQuery(regenerate),
    );
  } catch (error) {
    if (
      error instanceof TranscriptionConfigurationError ||
      error instanceof TranscriptionProviderError ||
      error instanceof AudioExtractionError
    ) {
      return sendTranscriptionError(reply, error);
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    throw error;
  }
});

app.get("/sessions/:sessionId/transcript", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };

  try {
    const uploadId = await resolveUploadId({ sessionId });
    await readUploadMetadata(uploadId);

    return {
      cached: true,
      transcript: await readUploadTranscript(uploadId),
      uploadId,
    };
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    if (!isFileNotFoundError(error)) {
      throw error;
    }

    return reply.code(404).send({
      error: "transcript_not_found",
      message: "Transcript not found.",
    });
  }
});

app.post("/sessions/:sessionId/transcript", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const { regenerate } = request.query as { regenerate?: unknown };

  try {
    const uploadId = await resolveUploadId({ sessionId });

    return {
      ...(await createOrReadTranscript(
        uploadId,
        parseRegenerateQuery(regenerate),
      )),
      uploadId,
    };
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (
      error instanceof TranscriptionConfigurationError ||
      error instanceof TranscriptionProviderError ||
      error instanceof AudioExtractionError
    ) {
      return sendTranscriptionError(reply, error);
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    throw error;
  }
});

app.post("/tools/get-video-metadata", async (request, reply) => {
  const parsedBody = getVideoMetadataToolRequestSchema.safeParse(
    request.body ?? {},
  );

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_tool_arguments",
      message: "Provide a sessionId or uploadId.",
    });
  }

  try {
    const uploadId = await resolveUploadId(parsedBody.data);
    const metadata = await readUploadMetadata(uploadId);

    return {
      metadata: toVideoMetadataResponse(metadata),
      uploadId,
    };
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    const probeUnavailableResponse = sendMediaProbeUnavailableError(
      reply,
      error,
    );
    if (probeUnavailableResponse) {
      return probeUnavailableResponse;
    }

    if (error instanceof MediaProbeError) {
      return reply.code(422).send({
        error: "video_metadata_unavailable",
        message: error.message,
      });
    }

    throw error;
  }
});

app.post("/tools/get-transcript", async (request, reply) => {
  const parsedBody = getTranscriptToolRequestSchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_tool_arguments",
      message: "Provide a sessionId or uploadId.",
    });
  }

  try {
    const uploadId = await resolveUploadId(parsedBody.data);

    return await createOrReadTranscript(
      uploadId,
      parsedBody.data.regenerate ?? false,
    );
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (
      error instanceof TranscriptionConfigurationError ||
      error instanceof TranscriptionProviderError ||
      error instanceof AudioExtractionError
    ) {
      return sendTranscriptionError(reply, error);
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    throw error;
  }
});

app.post("/tools/render-clip", async (request, reply) => {
  const parsedBody = renderClipToolRequestSchema.safeParse(request.body ?? {});

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_clip",
      message: parsedBody.error.issues[0]?.message ?? "Invalid clip request.",
    });
  }

  try {
    const uploadId = await resolveUploadId(parsedBody.data);

    return {
      render: await createUploadRender(uploadId, parsedBody.data.clip),
    };
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    const invalidClipResponse = sendInvalidClipError(reply, error);
    if (invalidClipResponse) {
      return invalidClipResponse;
    }

    throw error;
  }
});

app.post("/uploads/:uploadId/renders", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };
  const parsedBody = renderClipRequestSchema.safeParse(request.body ?? {});

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_clip",
      message: parsedBody.error.issues[0]?.message ?? "Invalid clip shape.",
    });
  }

  try {
    return reply.code(201).send({
      render: await createUploadRender(uploadId, parsedBody.data.clip),
    });
  } catch (error) {
    if (error instanceof InvalidStorageIdError) {
      return sendInvalidStorageIdError(reply, error);
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    const invalidClipResponse = sendInvalidClipError(reply, error);
    if (invalidClipResponse) {
      return invalidClipResponse;
    }

    request.log.error({ error, uploadId }, "Failed to render clip");

    return reply.code(500).send({
      error: "render_failed",
      message: "Could not render this clip.",
    });
  }
});

app.post("/sessions/:sessionId/renders", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const parsedBody = renderClipRequestSchema.safeParse(request.body ?? {});

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_clip",
      message: parsedBody.error.issues[0]?.message ?? "Invalid clip request.",
    });
  }

  try {
    const uploadId = await resolveUploadId({ sessionId });

    return {
      render: await createUploadRender(uploadId, parsedBody.data.clip),
    };
  } catch (error) {
    const resolutionResponse = sendSessionUploadResolutionError(reply, error);
    if (resolutionResponse) {
      return resolutionResponse;
    }

    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    const invalidClipResponse = sendInvalidClipError(reply, error);
    if (invalidClipResponse) {
      return invalidClipResponse;
    }

    throw error;
  }
});

app.get("/uploads/:uploadId/renders/:renderId", async (request, reply) => {
  const { renderId, uploadId } = request.params as {
    renderId: string;
    uploadId: string;
  };

  try {
    await readUploadMetadata(uploadId);

    const [clip, outputStats] = await Promise.all([
      readClipRenderPlan(uploadId, renderId),
      readRenderFileStats(uploadId, renderId),
    ]);

    return {
      render: {
        byteLength: outputStats.size,
        clip,
        id: renderId,
        mimeType: "video/mp4",
        uploadId,
        url: renderFileUrl(uploadId, renderId),
      },
    };
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    if (error instanceof RenderNotFoundError || isFileNotFoundError(error)) {
      return reply.code(404).send({
        error: "render_not_found",
        message: "Render not found.",
      });
    }

    throw error;
  }
});

app.get("/uploads/:uploadId/renders/:renderId/file", async (request, reply) => {
  const { renderId, uploadId } = request.params as {
    renderId: string;
    uploadId: string;
  };

  try {
    await readUploadMetadata(uploadId);
    await readRenderFileStats(uploadId, renderId);

    return reply
      .type("video/mp4")
      .header("content-disposition", `inline; filename="${renderId}.mp4"`)
      .send(createReadStream(getUploadRenderOutputPath(uploadId, renderId)));
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      return sendUploadNotFoundError(reply);
    }

    if (error instanceof RenderNotFoundError) {
      return reply.code(404).send({
        error: "render_not_found",
        message: "Render not found.",
      });
    }

    throw error;
  }
});

await Promise.all([
  mkdir(uploadRoot, { recursive: true }),
  mkdir(sessionRoot, { recursive: true }),
]);

await app.listen({ host, port });
