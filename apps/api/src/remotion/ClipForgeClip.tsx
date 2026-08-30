import {
  AbsoluteFill,
  Series,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  clipSegmentDurationInFrames,
  clipTransitionDurationInFrames,
  type ClipCaption,
  type ClipRenderPlan,
} from "../clip.js";
import { ChapterCard } from "./ChapterCard.js";
import { VideoSegment } from "./VideoSegment.js";

export type ClipForgeClipProps = {
  clip: ClipRenderPlan;
  sourceUrl: string;
};

function getActiveCaption(captions: ClipCaption[], elapsedMs: number) {
  return captions.find(
    (caption) => elapsedMs >= caption.startMs && elapsedMs <= caption.endMs,
  );
}

export const ClipForgeClip = ({ clip, sourceUrl }: ClipForgeClipProps) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const layoutScale = Math.min(
    1,
    Math.max(0.5, Math.min(width / 1080, height / 1920)),
  );
  const elapsedMs = (frame / fps) * 1000;
  const activeCaption = getActiveCaption(clip.captions, elapsedMs);
  const captionFrame = activeCaption
    ? frame - Math.round((activeCaption.startMs / 1000) * fps)
    : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808" }}>
      <Series>
        {clip.segments.flatMap((segment, index) => {
          const transition = segment.transitionAfter;
          const transitionDuration = clipTransitionDurationInFrames(
            transition,
            fps,
          );

          return [
            <Series.Sequence
              durationInFrames={clipSegmentDurationInFrames(segment, fps)}
              key={`${segment.id}-${index}`}
              premountFor={fps}
            >
              <VideoSegment
                clip={clip}
                segment={segment}
                sourceUrl={sourceUrl}
              />
            </Series.Sequence>,
            ...(transition?.kind === "card"
              ? [
                  <Series.Sequence
                    durationInFrames={transitionDuration}
                    key={`${segment.id}-${index}-transition`}
                    premountFor={fps}
                  >
                    <ChapterCard
                      durationInFrames={transitionDuration}
                      title={transition.title ?? clip.title}
                    />
                  </Series.Sequence>,
                ]
              : []),
          ];
        })}
      </Series>
      <div
        style={{
          alignItems: "center",
          bottom: 170 * layoutScale,
          display: "flex",
          justifyContent: "center",
          left: 72 * layoutScale,
          position: "absolute",
          right: 72 * layoutScale,
          textAlign: "center",
        }}
      >
        {activeCaption ? (
          <div
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.72)",
              borderRadius: 18 * layoutScale,
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.35)",
              color: "white",
              fontFamily:
                'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: 58 * layoutScale,
              fontWeight: 800,
              lineHeight: 1.12,
              opacity: interpolate(captionFrame, [0, 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              padding: `${26 * layoutScale}px ${34 * layoutScale}px`,
              textShadow: "0 2px 8px rgba(0,0,0,0.45)",
            }}
          >
            {activeCaption.text}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
