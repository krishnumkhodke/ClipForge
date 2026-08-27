"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  TrueForgeUI,
  type TrueForgeServerConfig,
} from "@truefoundry/trueforge-ui";

type FocusedVideo = {
  aspectRatio: number | null;
  name: string;
  url: string;
};

const DEFAULT_VIDEO_ASPECT_RATIO = 9 / 16;
const PREVIEW_BASE_WIDTH = 192;
const LANDSCAPE_TARGET_HEIGHT = 180;
const LANDSCAPE_MAX_WIDTH = 360;

function getPreviewWidth(aspectRatio: number | null) {
  if (!aspectRatio || aspectRatio <= 1) {
    return PREVIEW_BASE_WIDTH;
  }

  return Math.min(
    LANDSCAPE_MAX_WIDTH,
    Math.max(PREVIEW_BASE_WIDTH, aspectRatio * LANDSCAPE_TARGET_HEIGHT),
  );
}

export function TrueForgeChat() {
  const [focusedVideo, setFocusedVideo] = useState<FocusedVideo | null>(null);
  const focusedVideoUrlRef = useRef<string | null>(null);
  const videoInputId = useId();
  const focusedVideoAspectRatio =
    focusedVideo?.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO;
  const focusedVideoWidth = getPreviewWidth(focusedVideo?.aspectRatio ?? null);

  const server = useMemo<TrueForgeServerConfig>(
    () => ({
      type: "trueforge",
      baseUrl: "/trueforge",
    }),
    [],
  );

  useEffect(() => {
    return () => {
      if (focusedVideoUrlRef.current) {
        URL.revokeObjectURL(focusedVideoUrlRef.current);
      }
    };
  }, []);

  const handleVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (focusedVideoUrlRef.current) {
      URL.revokeObjectURL(focusedVideoUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    focusedVideoUrlRef.current = url;
    setFocusedVideo({
      aspectRatio: null,
      name: file.name,
      url,
    });

    const metadataVideo = document.createElement("video");
    metadataVideo.preload = "metadata";
    metadataVideo.onloadedmetadata = () => {
      const hasDimensions =
        metadataVideo.videoWidth > 0 && metadataVideo.videoHeight > 0;
      const aspectRatio = hasDimensions
        ? metadataVideo.videoWidth / metadataVideo.videoHeight
        : null;

      setFocusedVideo((currentVideo) =>
        currentVideo?.url === url ? { ...currentVideo, aspectRatio } : currentVideo,
      );
    };
    metadataVideo.src = url;

    event.target.value = "";
  };

  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      <TrueForgeUI
        server={server}
        layout="sidebar"
        theme={{
          brand: { name: "ClipForge" },
        }}
      />
      <section
        aria-label="Focused video"
        className="fixed right-3 top-12 z-50 w-40 overflow-hidden rounded-lg border border-black/10 bg-white/95 shadow-lg shadow-black/10 backdrop-blur sm:right-5 sm:w-48"
        style={
          focusedVideo
            ? { width: `min(calc(100vw - 1.5rem), ${focusedVideoWidth}px)` }
            : undefined
        }
      >
        <input
          id={videoInputId}
          aria-label="Upload video"
          className="sr-only"
          type="file"
          accept="video/*"
          onChange={handleVideoChange}
        />
        {focusedVideo ? (
          <div className="relative w-full">
            <div
              className="w-full bg-neutral-950"
              style={{ aspectRatio: focusedVideoAspectRatio }}
            >
              <video
                className="h-full w-full object-contain"
                src={focusedVideo.url}
                controls
                playsInline
                preload="metadata"
              />
            </div>
            <label
              aria-label="Change focused video"
              className="absolute right-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/90 text-xl leading-none text-neutral-700 shadow-sm transition hover:bg-white hover:text-neutral-950"
              htmlFor={videoInputId}
            >
              <span aria-hidden="true">+</span>
            </label>
            <div className="truncate border-t border-black/10 px-2 py-1.5 text-xs font-medium text-neutral-700">
              {focusedVideo.name}
            </div>
          </div>
        ) : (
          <label
            aria-label="Upload video"
            className="flex aspect-[9/16] w-full cursor-pointer items-center justify-center bg-neutral-50 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            htmlFor={videoInputId}
          >
            <span aria-hidden="true" className="text-4xl font-light leading-none">
              +
            </span>
          </label>
        )}
      </section>
    </main>
  );
}
