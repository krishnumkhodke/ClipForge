import { Composition, type CalculateMetadataFunction } from "remotion";
import { clipDurationInFrames } from "../clip.js";
import { ClipForgeClip, type ClipForgeClipProps } from "./ClipForgeClip.js";

const fps = 30;

const calculateMetadata: CalculateMetadataFunction<ClipForgeClipProps> = ({
  props,
}) => {
  return {
    durationInFrames: clipDurationInFrames(props.clip),
    fps: props.clip.output.fps,
    height: props.clip.output.height,
    props,
    width: props.clip.output.width,
  };
};

export const Root = () => {
  return (
    <Composition
      calculateMetadata={calculateMetadata}
      component={ClipForgeClip}
      defaultProps={{
        clip: {
          captions: [],
          id: "dummy-clip",
          output: {
            fps,
            height: 1920,
            width: 1080,
          },
          schemaVersion: 2,
          segments: [
            {
              endSeconds: 15,
              id: "segment-1",
              startSeconds: 0,
            },
          ],
          title: "ClipForge dummy clip",
          uploadId: "demo",
        },
        sourceUrl: "https://remotion.media/BigBuckBunny.mp4",
      }}
      durationInFrames={15 * fps}
      fps={fps}
      height={1920}
      id="ClipForgeClip"
      width={1080}
    />
  );
};
