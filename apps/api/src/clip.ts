import { z } from "zod";
import { storageIdSchema } from "./storage-id.js";
import type { Transcript } from "./transcription.js";

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

const clipRenderPlanBaseSchema = z.object({
  captions: z.array(clipCaptionSchema).default([]),
  endSeconds: z.number().positive(),
  id: z.string().min(1).default("dummy-clip"),
  output: clipOutputSchema.default({ fps: 30, height: 1920, width: 1080 }),
  startSeconds: z.number().nonnegative().default(0),
  title: z.string().min(1).default("ClipForge dummy clip"),
  uploadId: storageIdSchema,
});

export const clipRenderPlanSchema = clipRenderPlanBaseSchema.refine(
  (clip) => clip.endSeconds > clip.startSeconds,
  {
    message: "endSeconds must be greater than startSeconds.",
    path: ["endSeconds"],
  },
);

export const renderClipRequestSchema = z.object({
  clip: z
    .object({
      captions: z.array(clipCaptionSchema).optional(),
      endSeconds: z.number().positive().optional(),
      id: z.string().min(1).optional(),
      output: clipOutputSchema.partial().optional(),
      startSeconds: z.number().nonnegative().optional(),
      title: z.string().min(1).optional(),
      uploadId: storageIdSchema.optional(),
    })
    .optional(),
});

export type ClipCaption = z.infer<typeof clipCaptionSchema>;
export type ClipRenderPlan = z.infer<typeof clipRenderPlanSchema>;
export type ClipRenderPlanInput = Omit<Partial<ClipRenderPlan>, "output"> & {
  output?: Partial<ClipRenderPlan["output"]>;
};

function captionsForClip(
  transcript: Transcript | undefined,
  startSeconds: number,
  endSeconds: number,
) {
  if (!transcript) {
    return [];
  }

  const startMs = Math.round(startSeconds * 1000);
  const endMs = Math.round(endSeconds * 1000);

  return transcript.captions
    .filter((caption) => caption.endMs > startMs && caption.startMs < endMs)
    .map((caption) => ({
      confidence: caption.confidence,
      endMs: Math.min(caption.endMs, endMs) - startMs,
      startMs: Math.max(caption.startMs, startMs) - startMs,
      text: caption.text,
      timestampMs:
        caption.timestampMs === null
          ? null
          : Math.max(caption.timestampMs ?? caption.startMs, startMs) - startMs,
    }));
}

export function buildDummyClipRenderPlan(
  uploadId: string,
  transcript?: Transcript,
): ClipRenderPlan {
  const startSeconds = 0;
  const endSeconds = Math.min(transcript?.durationSeconds ?? 15, 15);

  return clipRenderPlanSchema.parse({
    captions: captionsForClip(transcript, startSeconds, endSeconds),
    endSeconds,
    id: "dummy-clip",
    output: {
      fps: 30,
      height: 1920,
      width: 1080,
    },
    startSeconds,
    title: "ClipForge dummy clip",
    uploadId,
  });
}

export function mergeClipRenderPlan(
  uploadId: string,
  clip: ClipRenderPlanInput | undefined,
  transcript?: Transcript,
) {
  const fallback = buildDummyClipRenderPlan(uploadId, transcript);
  const startSeconds = clip?.startSeconds ?? fallback.startSeconds;
  const endSeconds = clip?.endSeconds ?? fallback.endSeconds;

  return clipRenderPlanSchema.parse({
    ...fallback,
    ...clip,
    captions:
      clip?.captions ?? captionsForClip(transcript, startSeconds, endSeconds),
    endSeconds,
    output: {
      ...fallback.output,
      ...clip?.output,
    },
    startSeconds,
    uploadId,
  });
}
