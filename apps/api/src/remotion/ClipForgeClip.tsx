import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ClipCaption, ClipRenderPlan } from "../clip.js";

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
  const { fps } = useVideoConfig();
  const elapsedMs = (frame / fps) * 1000;
  const activeCaption = getActiveCaption(clip.captions, elapsedMs);
  const trimBefore = Math.round(clip.startSeconds * fps);
  const trimAfter = Math.round(clip.endSeconds * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808" }}>
      <OffthreadVideo
        src={sourceUrl}
        style={{
          height: "100%",
          objectFit: "cover",
          width: "100%",
        }}
        trimAfter={trimAfter}
        trimBefore={trimBefore}
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
          alignItems: "center",
          bottom: 170,
          display: "flex",
          justifyContent: "center",
          left: 72,
          position: "absolute",
          right: 72,
          textAlign: "center",
        }}
      >
        {activeCaption ? (
          <div
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.72)",
              borderRadius: 18,
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.35)",
              color: "white",
              fontFamily:
                'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: 58,
              fontWeight: 800,
              lineHeight: 1.12,
              opacity: interpolate(frame, [0, 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              padding: "26px 34px",
              textShadow: "0 2px 8px rgba(0,0,0,0.45)",
            }}
          >
            {activeCaption.text}
          </div>
        ) : null}
      </div>
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
