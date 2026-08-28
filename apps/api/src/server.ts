import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AudioExtractionError,
  TranscriptionConfigurationError,
  TranscriptionProviderError,
  transcribeUpload,
  type Transcript,
  type UploadMetadata,
} from "./transcription.js";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = process.env.MEDIA_DATA_DIR ?? join(apiRoot, ".data");
const uploadRoot = join(dataRoot, "uploads");
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
  return join(uploadRoot, uploadId);
}

function getUploadMetadataPath(uploadId: string) {
  return join(getUploadDirectory(uploadId), "metadata.json");
}

function getUploadTranscriptPath(uploadId: string) {
  return join(getUploadDirectory(uploadId), "transcript.json");
}

async function readUploadMetadata(uploadId: string) {
  const contents = await readFile(getUploadMetadataPath(uploadId), "utf8").catch(
    (error: unknown) => {
      if (isFileNotFoundError(error)) {
        throw new UploadNotFoundError(uploadId);
      }

      throw error;
    },
  );

  return JSON.parse(contents) as UploadMetadata;
}

async function readUploadTranscript(uploadId: string) {
  const contents = await readFile(getUploadTranscriptPath(uploadId), "utf8");

  return JSON.parse(contents) as Transcript;
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

const getTranscriptToolRequestSchema = z.object({
  regenerate: z.boolean().optional(),
  uploadId: z.string().min(1),
});

class UploadNotFoundError extends Error {
  constructor(uploadId: string) {
    super(`Upload ${uploadId} was not found.`);
    this.name = "UploadNotFoundError";
  }
}

function isFileNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

const app = Fastify({
  logger: true,
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

app.post("/uploads", async (request, reply) => {
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
    const metadata: UploadMetadata = {
      byteLength: fileStats.size,
      createdAt: new Date().toISOString(),
      id: uploadId,
      mimeType: upload.mimetype,
      originalFilename: safeFilename,
      sourcePath,
    };

    await writeFile(
      getUploadMetadataPath(uploadId),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );

    return reply.code(201).send({
      upload: {
        byteLength: metadata.byteLength,
        createdAt: metadata.createdAt,
        id: metadata.id,
        mimeType: metadata.mimeType,
        originalFilename: metadata.originalFilename,
        url: `/uploads/${metadata.id}/file`,
      },
    });
  } catch (error) {
    await rm(uploadDirectory, { force: true, recursive: true });
    request.log.error({ error, uploadId }, "Failed to store upload");

    throw error;
  }
});

app.get("/uploads/:uploadId", async (request, reply) => {
  const { uploadId } = request.params as { uploadId: string };

  try {
    const metadata = await readUploadMetadata(uploadId);

    return {
      upload: {
        byteLength: metadata.byteLength,
        createdAt: metadata.createdAt,
        id: metadata.id,
        mimeType: metadata.mimeType,
        originalFilename: metadata.originalFilename,
        url: `/uploads/${metadata.id}/file`,
      },
    };
  } catch (error) {
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

app.post("/tools/get-transcript", async (request, reply) => {
  const parsedBody = getTranscriptToolRequestSchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply.code(400).send({
      error: "invalid_tool_arguments",
      message: "Provide an uploadId.",
    });
  }

  try {
    return await createOrReadTranscript(
      parsedBody.data.uploadId,
      parsedBody.data.regenerate ?? false,
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

const port = Number(process.env.PORT ?? 4000);

await app.listen({
  host: "127.0.0.1",
  port,
});
