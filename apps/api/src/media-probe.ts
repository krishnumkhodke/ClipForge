import { spawn } from "node:child_process";
import process from "node:process";

type ProbeStream = {
  avg_frame_rate?: string;
  codec_name?: string;
  codec_type?: "audio" | "video";
  duration?: string;
  height?: number;
  r_frame_rate?: string;
  side_data_list?: Array<{ rotation?: number }>;
  tags?: { rotate?: string };
  width?: number;
};

type ProbeOutput = {
  format?: { duration?: string };
  streams?: ProbeStream[];
};

export type VideoMetadata = {
  aspectRatio: number;
  audioCodec?: string;
  displayAspectRatio: string;
  durationSeconds: number;
  fps?: number;
  hasAudio: boolean;
  height: number;
  rotationDegrees: number;
  videoCodec?: string;
  width: number;
};

export class MediaProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProbeError";
  }
}

function parsePositiveNumber(value: string | undefined) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") {
    return undefined;
  }

  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? 1);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return undefined;
  }

  return Math.round((numerator / denominator) * 1000) / 1000;
}

function normalizeRotation(stream: ProbeStream) {
  const rawRotation =
    stream.side_data_list?.find((sideData) =>
      Number.isFinite(sideData.rotation),
    )?.rotation ?? Number(stream.tags?.rotate ?? 0);

  if (!Number.isFinite(rawRotation)) {
    return 0;
  }

  return ((Math.round(rawRotation) % 360) + 360) % 360;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b > 0) {
    [a, b] = [b, a % b];
  }

  return a || 1;
}

async function runFfprobe(sourcePath: string) {
  const command = process.env.FFPROBE_PATH ?? "ffprobe";

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      command,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation",
        "-of",
        "json",
        sourcePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      reject(
        new MediaProbeError(
          `${command} could not be started: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }

      reject(
        new MediaProbeError(
          `${command} exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`,
        ),
      );
    });
  });
}

export async function probeVideoMetadata(
  sourcePath: string,
): Promise<VideoMetadata> {
  const rawOutput = await runFfprobe(sourcePath);
  let output: ProbeOutput;

  try {
    output = JSON.parse(rawOutput) as ProbeOutput;
  } catch {
    throw new MediaProbeError("ffprobe returned invalid JSON.");
  }

  const videoStream = output.streams?.find(
    (stream) => stream.codec_type === "video",
  );
  const audioStream = output.streams?.find(
    (stream) => stream.codec_type === "audio",
  );

  if (!videoStream?.width || !videoStream.height) {
    throw new MediaProbeError(
      "The upload does not contain a readable video stream.",
    );
  }

  const durationSeconds =
    parsePositiveNumber(videoStream.duration) ??
    parsePositiveNumber(output.format?.duration);

  if (!durationSeconds) {
    throw new MediaProbeError("The video duration could not be determined.");
  }

  const rotationDegrees = normalizeRotation(videoStream);
  const swapsDimensions = rotationDegrees === 90 || rotationDegrees === 270;
  const width = swapsDimensions ? videoStream.height : videoStream.width;
  const height = swapsDimensions ? videoStream.width : videoStream.height;
  const divisor = greatestCommonDivisor(width, height);
  const fps = parseFrameRate(
    videoStream.avg_frame_rate ?? videoStream.r_frame_rate,
  );

  return {
    aspectRatio: Math.round((width / height) * 1_000_000) / 1_000_000,
    ...(audioStream?.codec_name ? { audioCodec: audioStream.codec_name } : {}),
    displayAspectRatio: `${width / divisor}:${height / divisor}`,
    durationSeconds,
    ...(fps ? { fps } : {}),
    hasAudio: Boolean(audioStream),
    height,
    rotationDegrees,
    ...(videoStream.codec_name ? { videoCodec: videoStream.codec_name } : {}),
    width,
  };
}
