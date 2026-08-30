import { AbsoluteFill, OffthreadVideo, useVideoConfig } from "remotion";
import type { ClipRenderPlan, ClipSegment } from "../clip.js";

type VideoSegmentProps = {
  clip: ClipRenderPlan;
  segment: ClipSegment;
  sourceUrl: string;
};

export const VideoSegment = ({
  clip,
  segment,
  sourceUrl,
}: VideoSegmentProps) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808" }}>
      <OffthreadVideo
        src={sourceUrl}
        style={{
          height: "100%",
          objectFit: "cover",
          width: "100%",
        }}
        trimAfter={Math.round(segment.endSeconds * fps)}
        trimBefore={Math.round(segment.startSeconds * fps)}
        volume={1}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      <div
        style={{
          color: "rgba(255, 255, 255, 0.82)",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 30,
          fontWeight: 700,
          left: 56,
          letterSpacing: 0,
          position: "absolute",
          right: 56,
          top: 52,
        }}
      >
        {clip.title}
      </div>
    </AbsoluteFill>
  );
};
