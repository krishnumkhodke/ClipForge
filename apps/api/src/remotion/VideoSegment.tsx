import { AbsoluteFill, OffthreadVideo, useVideoConfig } from "remotion";
import {
  clipSegmentFrameRange,
  type ClipRenderPlan,
  type ClipSegment,
} from "../clip.js";

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
  const { fps, height, width } = useVideoConfig();
  const { endFrame, startFrame } = clipSegmentFrameRange(segment, fps);
  const layoutScale = Math.min(
    1,
    Math.max(0.6, Math.min(width / 1080, height / 1920)),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808" }}>
      <OffthreadVideo
        src={sourceUrl}
        style={{
          height: "100%",
          objectFit: "cover",
          width: "100%",
        }}
        trimAfter={endFrame}
        trimBefore={startFrame}
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
          fontSize: 30 * layoutScale,
          fontWeight: 700,
          left: 56 * layoutScale,
          letterSpacing: 0,
          position: "absolute",
          right: 56 * layoutScale,
          top: 52 * layoutScale,
        }}
      >
        {clip.title}
      </div>
    </AbsoluteFill>
  );
};
