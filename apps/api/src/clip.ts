import { z } from "zod";
import type { VideoMetadata } from "./media-probe.js";
import { storageIdSchema } from "./storage-id.js";
import type { Transcript } from "./transcription.js";

const MAX_CLIP_SEGMENTS = 8;
const DEFAULT_CARD_DURATION_SECONDS = 0.8;

export const clipCaptionSchema = z.object({
  confidence: z.number().nullable().optional(),
  endMs: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  text: z.string().min(1),
  timestampMs: z.number().int().nonnegative().nullable().optional(),
});

const clipOutputSchema = z.object({
  fps: z.number().int().positive().default(30),
  height: z.number().int().positive().default(1920),
  width: z.number().int().positive().default(1080),
});
const clipCaptionsInputSchema = z.union([
  z.array(clipCaptionSchema),
  z.boolean(),
]);

const cutTransitionSchema = z.object({
  kind: z.literal("cut"),
});
const chapterCardTransitionSchema = z.object({
  durationSeconds: z
    .number()
    .min(0.25)
    .max(3)
    .default(DEFAULT_CARD_DURATION_SECONDS),
  kind: z.literal("card"),
  preset: z.literal("chapter").default("chapter"),
  title: z.string().trim().min(1).max(120).optional(),
});

export const clipTransitionSchema = z.discriminatedUnion("kind", [
  cutTransitionSchema,
  chapterCardTransitionSchema,
]);

const clipSegmentFields = {
  endSeconds: z.number().positive(),
  startSeconds: z.number().nonnegative(),
  transitionAfter: clipTransitionSchema.optional(),
};

export const clipSegmentSchema = z
  .object({
    ...clipSegmentFields,
    id: z.string().trim().min(1).max(80),
  })
  .refine((segment) => segment.endSeconds > segment.startSeconds, {
    message: "endSeconds must be greater than startSeconds.",
    path: ["endSeconds"],
  });

const clipSegmentInputSchema = z
  .object({
    ...clipSegmentFields,
    id: z.string().trim().min(1).max(80).optional(),
  })
  .refine((segment) => segment.endSeconds > segment.startSeconds, {
    message: "endSeconds must be greater than startSeconds.",
    path: ["endSeconds"],
  });

const clipRenderInputFields = {
  captions: clipCaptionsInputSchema.optional(),
  id: z.string().min(1).optional(),
  output: clipOutputSchema.partial().optional(),
  schemaVersion: z.literal(2).optional(),
  title: z.string().min(1).optional(),
  uploadId: storageIdSchema.optional(),
};

const clipSegmentsInputSchema = z
  .array(clipSegmentInputSchema)
  .min(1)
  .max(MAX_CLIP_SEGMENTS);

function validateLastSegmentTransition(
  segments: Array<{ transitionAfter?: z.infer<typeof clipTransitionSchema> }>,
  context: z.core.$RefinementCtx,
) {
  const lastTransition = segments.at(-1)?.transitionAfter;

  if (lastTransition?.kind === "card") {
    context.addIssue({
      code: "custom",
      message: "The last segment cannot have a card transition after it.",
      path: ["segments", segments.length - 1, "transitionAfter"],
    });
  }
}

export const clipRenderPlanSchema = z
  .object({
    captions: z.array(clipCaptionSchema).default([]),
    id: z.string().min(1).default("dummy-clip"),
    output: clipOutputSchema.default({ fps: 30, height: 1920, width: 1080 }),
    schemaVersion: z.literal(2).default(2),
    segments: z.array(clipSegmentSchema).min(1).max(MAX_CLIP_SEGMENTS),
    title: z.string().min(1).default("ClipForge dummy clip"),
    uploadId: storageIdSchema,
  })
  .superRefine((clip, context) =>
    validateLastSegmentTransition(clip.segments, context),
  );

const clipRenderInputSchema = z
  .object({
    ...clipRenderInputFields,
    endSeconds: z.number().positive().optional(),
    segments: clipSegmentsInputSchema.optional(),
    startSeconds: z.number().nonnegative().optional(),
  })
  .superRefine((clip, context) => {
    if (
      clip.segments &&
      (clip.startSeconds !== undefined || clip.endSeconds !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Use either segments or startSeconds/endSeconds, not both in the same clip.",
        path: ["segments"],
      });
    }

    if (clip.segments) {
      validateLastSegmentTransition(clip.segments, context);
    }
  });

export const agentClipRenderInputSchema = z
  .object({
    ...clipRenderInputFields,
    segments: clipSegmentsInputSchema,
  })
  .superRefine((clip, context) =>
    validateLastSegmentTransition(clip.segments, context),
  );

export const renderClipRequestSchema = z.object({
  clip: clipRenderInputSchema.optional(),
});

export type ClipCaption = z.infer<typeof clipCaptionSchema>;
export type ClipTransition = z.infer<typeof clipTransitionSchema>;
export type ClipSegment = z.infer<typeof clipSegmentSchema>;
export type ClipRenderPlan = z.infer<typeof clipRenderPlanSchema>;
export type ClipRenderPlanInput = z.infer<typeof clipRenderInputSchema>;

export class ClipSourceRangeError extends Error {
  constructor(
    readonly segmentIndex: number,
    readonly durationSeconds: number,
  ) {
    super(
      `Segment ${segmentIndex + 1} must stay within the source video duration of ${durationSeconds} seconds.`,
    );
    this.name = "ClipSourceRangeError";
  }
}

export function clipSegmentFrameRange(segment: ClipSegment, fps: number) {
  const startFrame = Math.round(segment.startSeconds * fps);
  const endFrame = Math.max(
    startFrame + 1,
    Math.round(segment.endSeconds * fps),
  );

  return {
    durationInFrames: endFrame - startFrame,
    endFrame,
    startFrame,
  };
}

export function clipSegmentDurationInFrames(segment: ClipSegment, fps: number) {
  return clipSegmentFrameRange(segment, fps).durationInFrames;
}

export function clipTransitionDurationInFrames(
  transition: ClipTransition | undefined,
  fps: number,
) {
  return transition?.kind === "card"
    ? Math.max(1, Math.round(transition.durationSeconds * fps))
    : 0;
}

export function clipDurationInFrames(clip: ClipRenderPlan) {
  return clip.segments.reduce(
    (duration, segment) =>
      duration +
      clipSegmentDurationInFrames(segment, clip.output.fps) +
      clipTransitionDurationInFrames(segment.transitionAfter, clip.output.fps),
    0,
  );
}

export function clipDurationSeconds(clip: ClipRenderPlan) {
  return clipDurationInFrames(clip) / clip.output.fps;
}

function mapCaptionsFromSourceTimeline(
  captions: ClipCaption[],
  segments: ClipSegment[],
  fps: number,
) {
  const mapped: ClipCaption[] = [];
  let outputOffsetMs = 0;

  for (const segment of segments) {
    const sourceStartMs = Math.round(segment.startSeconds * 1000);
    const sourceEndMs = Math.round(segment.endSeconds * 1000);

    for (const caption of captions) {
      if (caption.endMs <= sourceStartMs || caption.startMs >= sourceEndMs) {
        continue;
      }

      const clippedStartMs = Math.max(caption.startMs, sourceStartMs);
      const clippedEndMs = Math.min(caption.endMs, sourceEndMs);
      const timestampMs = caption.timestampMs ?? caption.startMs;

      mapped.push({
        confidence: caption.confidence,
        endMs: outputOffsetMs + clippedEndMs - sourceStartMs,
        startMs: outputOffsetMs + clippedStartMs - sourceStartMs,
        text: caption.text,
        timestampMs:
          caption.timestampMs === null
            ? null
            : outputOffsetMs +
              Math.min(Math.max(timestampMs, sourceStartMs), sourceEndMs) -
              sourceStartMs,
      });
    }

    outputOffsetMs += Math.round(
      (clipSegmentDurationInFrames(segment, fps) / fps) * 1000,
    );
    outputOffsetMs += Math.round(
      (clipTransitionDurationInFrames(segment.transitionAfter, fps) / fps) *
        1000,
    );
  }

  return mapped;
}

function captionsForClip(
  transcript: Transcript | undefined,
  segments: ClipSegment[],
  fps: number,
) {
  if (!transcript) {
    return [];
  }

  return mapCaptionsFromSourceTimeline(transcript.captions, segments, fps);
}

function normalizeClipCaptions(
  captions: ClipCaption[],
  segments: ClipSegment[],
  fps: number,
) {
  if (captions.length === 0) {
    return captions;
  }

  const outputDurationMs = Math.round(
    (segments.reduce(
      (duration, segment) =>
        duration +
        clipSegmentDurationInFrames(segment, fps) +
        clipTransitionDurationInFrames(segment.transitionAfter, fps),
      0,
    ) /
      fps) *
      1000,
  );
  const maxCaptionEndMs = Math.max(...captions.map((caption) => caption.endMs));

  if (maxCaptionEndMs <= outputDurationMs + 1000 / fps) {
    return captions;
  }

  return mapCaptionsFromSourceTimeline(captions, segments, fps);
}

function resolveClipCaptions(
  captions: ClipRenderPlanInput["captions"] | undefined,
  transcript: Transcript | undefined,
  segments: ClipSegment[],
  fps: number,
) {
  if (captions === false) {
    return [];
  }

  if (captions === true || captions === undefined) {
    return captionsForClip(transcript, segments, fps);
  }

  return normalizeClipCaptions(captions, segments, fps);
}

function normalizeSegments(
  clip: ClipRenderPlanInput | undefined,
  fallback: ClipRenderPlan,
): ClipSegment[] {
  if (clip?.segments) {
    return clip.segments.map((segment, index) =>
      clipSegmentSchema.parse({
        ...segment,
        id: segment.id ?? `segment-${index + 1}`,
      }),
    );
  }

  const fallbackSegment = fallback.segments[0];
  if (!fallbackSegment) {
    throw new Error("The fallback clip must contain one segment.");
  }

  return [
    clipSegmentSchema.parse({
      ...fallbackSegment,
      endSeconds: clip?.endSeconds ?? fallbackSegment.endSeconds,
      startSeconds: clip?.startSeconds ?? fallbackSegment.startSeconds,
    }),
  ];
}

function validateSegmentsWithinVideo(
  segments: ClipSegment[],
  video: VideoMetadata | undefined,
  fps: number,
) {
  if (!video) {
    return;
  }

  const frameToleranceSeconds = 1 / fps;

  segments.forEach((segment, index) => {
    if (
      segment.startSeconds >= video.durationSeconds ||
      segment.endSeconds > video.durationSeconds + frameToleranceSeconds
    ) {
      throw new ClipSourceRangeError(index, video.durationSeconds);
    }
  });
}

export function buildDummyClipRenderPlan(
  uploadId: string,
  transcript?: Transcript,
  video?: VideoMetadata,
): ClipRenderPlan {
  const startSeconds = 0;
  const endSeconds = Math.min(
    transcript?.durationSeconds ?? video?.durationSeconds ?? 15,
    15,
  );
  const segments = [
    clipSegmentSchema.parse({
      endSeconds,
      id: "segment-1",
      startSeconds,
    }),
  ];
  const defaultOutput = defaultOutputDimensions(video);

  return clipRenderPlanSchema.parse({
    captions: captionsForClip(transcript, segments, 30),
    id: "dummy-clip",
    output: {
      fps: 30,
      ...defaultOutput,
    },
    schemaVersion: 2,
    segments,
    title: "ClipForge dummy clip",
    uploadId,
  });
}

export function mergeClipRenderPlan(
  uploadId: string,
  clip: ClipRenderPlanInput | undefined,
  transcript?: Transcript,
  video?: VideoMetadata,
) {
  const fallback = buildDummyClipRenderPlan(uploadId, transcript, video);
  const segments = normalizeSegments(clip, fallback);
  const output = {
    ...fallback.output,
    ...clip?.output,
  };

  validateSegmentsWithinVideo(segments, video, output.fps);

  return clipRenderPlanSchema.parse({
    ...fallback,
    ...clip,
    captions: resolveClipCaptions(
      clip?.captions,
      transcript,
      segments,
      output.fps,
    ),
    output,
    schemaVersion: 2,
    segments,
    uploadId,
  });
}

function evenDimension(dimension: number) {
  return Math.max(2, dimension - (dimension % 2));
}

function defaultOutputDimensions(video: VideoMetadata | undefined) {
  if (!video) {
    return { height: 1920, width: 1080 };
  }

  const maxDefaultEdge = 1920;
  const scale = Math.min(
    1,
    maxDefaultEdge / Math.max(video.width, video.height),
  );

  return {
    height: evenDimension(Math.round(video.height * scale)),
    width: evenDimension(Math.round(video.width * scale)),
  };
}
