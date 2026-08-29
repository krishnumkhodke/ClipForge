import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { nanoid } from "nanoid";

export type UploadMetadata = {
  byteLength: number;
  createdAt: string;
  id: string;
  mimeType: string;
  originalFilename: string;
  sourcePath: string;
  trueforgeSessionId?: string;
};

export type TranscriptSegment = {
  endSeconds: number;
  id: string;
  startSeconds: number;
  text: string;
};

export type TranscriptCaption = {
  confidence: number | null;
  endMs: number;
  startMs: number;
  text: string;
  timestampMs: number | null;
};

export type Transcript = {
  captions: TranscriptCaption[];
  createdAt: string;
  durationSeconds?: number;
  id: string;
  language?: string;
  provider: {
    model: string;
    name: "openai";
  };
  segments: TranscriptSegment[];
  status: "ready";
  text: string;
  uploadId: string;
};

type OpenAITranscriptSegment = {
  end: number;
  id: number;
  start: number;
  text: string;
};

type OpenAIVerboseTranscript = {
  duration?: number;
  language?: string;
  segments?: OpenAITranscriptSegment[];
  text: string;
};

export class TranscriptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionConfigurationError";
  }
}

export class TranscriptionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionProviderError";
  }
}

export class AudioExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioExtractionError";
  }
}

function getFfmpegPath() {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function getOpenAITranscriptionModel() {
  return process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";
}

function assertTranscriptionConfigured() {
  if (!process.env.OPENAI_API_KEY) {
    throw new TranscriptionConfigurationError(
      "OPENAI_API_KEY is required to generate transcripts.",
    );
  }
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      reject(
        new AudioExtractionError(
          `${command} could not be started: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new AudioExtractionError(
          `${command} exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`,
        ),
      );
    });
  });
}

async function extractAudio(upload: UploadMetadata, uploadDirectory: string) {
  const audioPath = join(uploadDirectory, "transcript-source.mp3");

  await runCommand(getFfmpegPath(), [
    "-y",
    "-i",
    upload.sourcePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    audioPath,
  ]);

  return audioPath;
}

function normalizeOpenAITranscript(
  response: OpenAIVerboseTranscript,
  upload: UploadMetadata,
): Transcript {
  const segments =
    response.segments?.map((segment) => ({
      endSeconds: segment.end,
      id: `seg_${String(segment.id).padStart(4, "0")}`,
      startSeconds: segment.start,
      text: segment.text.trim(),
    })) ?? [];

  return {
    captions: segments.map((segment) => ({
      confidence: null,
      endMs: Math.round(segment.endSeconds * 1000),
      startMs: Math.round(segment.startSeconds * 1000),
      text: segment.text,
      timestampMs: Math.round(segment.startSeconds * 1000),
    })),
    createdAt: new Date().toISOString(),
    durationSeconds: response.duration,
    id: nanoid(),
    language: response.language,
    provider: {
      model: getOpenAITranscriptionModel(),
      name: "openai",
    },
    segments,
    status: "ready",
    text: response.text,
    uploadId: upload.id,
  };
}

async function transcribeAudioWithOpenAI(audioPath: string) {
  const audio = await readFile(audioPath);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
    "audio.mp3",
  );
  formData.append("model", getOpenAITranscriptionModel());
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  if (process.env.OPENAI_TRANSCRIPTION_LANGUAGE) {
    formData.append("language", process.env.OPENAI_TRANSCRIPTION_LANGUAGE);
  }

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      body: formData,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      method: "POST",
    },
  ).catch((error: unknown) => {
    throw new TranscriptionProviderError(
      error instanceof Error
        ? `Could not reach OpenAI transcription API: ${error.message}`
        : "Could not reach OpenAI transcription API.",
    );
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new TranscriptionProviderError(
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "OpenAI transcription request failed.",
    );
  }

  if (!body || typeof body !== "object" || !("text" in body)) {
    throw new TranscriptionProviderError(
      "OpenAI transcription response did not include transcript text.",
    );
  }

  return body as OpenAIVerboseTranscript;
}

export async function transcribeUpload(
  upload: UploadMetadata,
  uploadDirectory: string,
) {
  assertTranscriptionConfigured();

  const audioPath = await extractAudio(upload, uploadDirectory);

  try {
    const transcript = await transcribeAudioWithOpenAI(audioPath);

    return normalizeOpenAITranscript(transcript, upload);
  } finally {
    await rm(audioPath, { force: true });
  }
}
