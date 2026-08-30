import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type ChapterCardProps = {
  durationInFrames: number;
  title: string;
};

export const ChapterCard = ({ durationInFrames, title }: ChapterCardProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enterFrames = Math.min(
    Math.max(1, Math.round(fps * 0.2)),
    Math.max(1, Math.floor((durationInFrames - 1) / 2)),
  );
  let opacity = 1;

  if (durationInFrames > 2) {
    const exitStart = durationInFrames - 1 - enterFrames;
    const enterOpacity = interpolate(frame, [0, enterFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const exitOpacity = interpolate(
      frame,
      [exitStart, durationInFrames - 1],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );

    opacity = Math.min(enterOpacity, exitOpacity);
  }
  const translateY = interpolate(frame, [0, enterFrames], [28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        backgroundColor: "#111111",
        color: "white",
        display: "flex",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        justifyContent: "center",
        padding: 96,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          gap: 34,
          opacity,
          textAlign: "center",
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            backgroundColor: "#8b5cf6",
            height: 8,
            width: 96,
          }}
        />
        <div
          style={{
            fontSize: 76,
            fontWeight: 850,
            lineHeight: 1.04,
            maxWidth: 860,
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
