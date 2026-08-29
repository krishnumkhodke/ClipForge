"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import {
  TrueForgeUI,
  type SlotOverrides,
  type TrueForgeServerConfig,
} from "@truefoundry/trueforge-ui";
import { ClipForgeMarkdown } from "./clipforge-markdown";
import { ClipForgeToolCallContentBlock } from "./clipforge-tool-response";

type FocusedVideo = {
  aspectRatio: number | null;
  name: string;
  uploadId: string | null;
  url: string;
};

type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";

type MediaUploadResponse = {
  upload: {
    id: string;
  };
};

const DEFAULT_VIDEO_ASPECT_RATIO = 9 / 16;
const PREVIEW_BASE_WIDTH = 192;
const LANDSCAPE_TARGET_HEIGHT = 180;
const LANDSCAPE_MAX_WIDTH = 360;
const PREVIEW_TOP_OFFSET = 48;
const PREVIEW_BOTTOM_MARGIN = 16;
const PREVIEW_FILENAME_HEIGHT = 30;
const PREVIEW_STATUS_HEIGHT = 30;
const PREVIEW_ERROR_HEIGHT = 44;
const MIN_PREVIEW_FRAME_HEIGHT = 120;
const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const CONFIGURED_MAX_UPLOAD_BYTES = Number(
  process.env.NEXT_PUBLIC_MEDIA_MAX_UPLOAD_BYTES,
);
const MAX_UPLOAD_BYTES =
  Number.isFinite(CONFIGURED_MAX_UPLOAD_BYTES) &&
  CONFIGURED_MAX_UPLOAD_BYTES > 0
    ? Math.floor(CONFIGURED_MAX_UPLOAD_BYTES)
    : DEFAULT_MAX_UPLOAD_BYTES;
const VIDEO_FILE_EXTENSIONS = /\.(avi|m4v|mkv|mov|mp4|ogg|ogv|webm)$/i;
const MEDIA_API_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CLIPFORGE_API_BASE_URL ??
  "http://127.0.0.1:4000";

function isLikelyVideoFile(file: File) {
  return (
    file.type.startsWith("video/") || VIDEO_FILE_EXTENSIONS.test(file.name)
  );
}

function getTargetPreviewWidth(aspectRatio: number | null) {
  if (!aspectRatio || aspectRatio <= 1) {
    return PREVIEW_BASE_WIDTH;
  }

  return Math.min(
    LANDSCAPE_MAX_WIDTH,
    Math.max(PREVIEW_BASE_WIDTH, aspectRatio * LANDSCAPE_TARGET_HEIGHT),
  );
}

function getPreviewStyle({
  aspectRatio,
  hasError,
  hasFilename,
  hasStatus,
  viewportHeight,
}: {
  aspectRatio: number;
  hasError: boolean;
  hasFilename: boolean;
  hasStatus: boolean;
  viewportHeight: number | null;
}): CSSProperties {
  const targetWidth = getTargetPreviewWidth(aspectRatio);

  if (!viewportHeight) {
    return {
      width: `min(calc(100vw - 1.5rem), ${targetWidth}px)`,
    };
  }

  const previewChromeHeight =
    PREVIEW_TOP_OFFSET +
    PREVIEW_BOTTOM_MARGIN +
    (hasFilename ? PREVIEW_FILENAME_HEIGHT : 0) +
    (hasStatus ? PREVIEW_STATUS_HEIGHT : 0) +
    (hasError ? PREVIEW_ERROR_HEIGHT : 0);
  const maxFrameHeight = Math.max(
    MIN_PREVIEW_FRAME_HEIGHT,
    viewportHeight - previewChromeHeight,
  );

  return {
    width: `min(calc(100vw - 1.5rem), ${Math.min(
      targetWidth,
      maxFrameHeight * aspectRatio,
    )}px)`,
  };
}

export function TrueForgeChat() {
  const [focusedVideo, setFocusedVideo] = useState<FocusedVideo | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const focusedVideoUrlRef = useRef<string | null>(null);
  const uploadAttemptRef = useRef(0);
  const videoInputId = useId();
  const focusedVideoAspectRatio =
    focusedVideo?.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO;
  const previewStyle = getPreviewStyle({
    aspectRatio: focusedVideoAspectRatio,
    hasError: Boolean(uploadError),
    hasFilename: Boolean(focusedVideo),
    hasStatus: Boolean(focusedVideo) && uploadStatus !== "idle",
    viewportHeight,
  });

  const server = useMemo<TrueForgeServerConfig>(
    () => ({
      type: "trueforge",
      baseUrl: "/trueforge",
    }),
    [],
  );
  const overrides = useMemo<SlotOverrides>(
    () => ({
      Markdown: ClipForgeMarkdown,
      ToolCallContentBlock: ClipForgeToolCallContentBlock,
    }),
    [],
  );

  useEffect(() => {
    const updateViewportHeight = () => setViewportHeight(window.innerHeight);

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
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

    uploadAttemptRef.current += 1;
    const uploadAttempt = uploadAttemptRef.current;

    if (!isLikelyVideoFile(file)) {
      setUploadError("Choose a video file such as MP4, MOV, or WebM.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Videos must be 1 GB or smaller.");
      event.target.value = "";
      return;
    }

    const url = URL.createObjectURL(file);
    const metadataVideo = document.createElement("video");
    metadataVideo.preload = "metadata";
    metadataVideo.onloadedmetadata = null;
    metadataVideo.onerror = null;

    const cleanupMetadataVideo = () => {
      metadataVideo.onloadedmetadata = null;
      metadataVideo.onerror = null;
      metadataVideo.removeAttribute("src");
      metadataVideo.load();
    };

    metadataVideo.onloadedmetadata = () => {
      if (uploadAttempt !== uploadAttemptRef.current) {
        URL.revokeObjectURL(url);
        cleanupMetadataVideo();
        return;
      }

      const hasDimensions =
        metadataVideo.videoWidth > 0 && metadataVideo.videoHeight > 0;

      if (!hasDimensions) {
        URL.revokeObjectURL(url);
        setUploadError(
          "This video has no readable dimensions. Choose another file.",
        );
        cleanupMetadataVideo();
        return;
      }

      if (focusedVideoUrlRef.current) {
        URL.revokeObjectURL(focusedVideoUrlRef.current);
      }

      focusedVideoUrlRef.current = url;
      setFocusedVideo({
        aspectRatio: metadataVideo.videoWidth / metadataVideo.videoHeight,
        name: file.name,
        uploadId: null,
        url,
      });
      setUploadError(null);
      setUploadStatus("uploading");
      cleanupMetadataVideo();
      void uploadVideoToMediaService(file, uploadAttempt, url);
    };

    metadataVideo.onerror = () => {
      if (uploadAttempt === uploadAttemptRef.current) {
        setUploadError(
          "This video could not be loaded. Try an MP4, MOV, or WebM file.",
        );
      }

      URL.revokeObjectURL(url);
      cleanupMetadataVideo();
    };
    metadataVideo.src = url;

    event.target.value = "";
  };

  const uploadVideoToMediaService = async (
    file: File,
    uploadAttempt: number,
    videoUrl: string,
  ) => {
    const formData = new FormData();
    formData.append("video", file);

    try {
      const response = await fetch(`${MEDIA_API_BASE_URL}/uploads`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        MediaUploadResponse | { message?: string } | null;

      if (!response.ok) {
        throw new Error(
          body && "message" in body && body.message
            ? body.message
            : "The media service rejected this upload.",
        );
      }

      if (!body || !("upload" in body)) {
        throw new Error("The media service returned an unexpected response.");
      }

      if (uploadAttempt !== uploadAttemptRef.current) {
        return;
      }

      setFocusedVideo((currentVideo) =>
        currentVideo?.url === videoUrl
          ? { ...currentVideo, uploadId: body.upload.id }
          : currentVideo,
      );
      setUploadStatus("uploaded");
      setUploadError(null);
    } catch (error) {
      if (uploadAttempt !== uploadAttemptRef.current) {
        return;
      }

      setUploadStatus("failed");
      setUploadError(
        error instanceof Error
          ? error.message
          : "The media service could not save this upload.",
      );
    }
  };

  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      <TrueForgeUI
        server={server}
        layout="sidebar"
        overrides={overrides}
        theme={{
          brand: { name: "ClipForge" },
        }}
      />
      <section
        aria-label="Focused video"
        className="fixed right-3 top-12 z-50 max-h-[calc(100dvh-4rem)] w-40 overflow-y-auto overflow-x-hidden rounded-lg border border-black/10 bg-white/95 shadow-lg shadow-black/10 backdrop-blur sm:right-5 sm:w-48"
        style={previewStyle}
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
                onError={() =>
                  setUploadError(
                    "This video cannot be played here. Choose a different file.",
                  )
                }
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
            {uploadStatus !== "idle" ? (
              <div className="border-t border-black/10 px-2 py-1.5 text-xs text-neutral-500">
                {uploadStatus === "uploading" ? "Uploading..." : null}
                {uploadStatus === "uploaded" && focusedVideo.uploadId
                  ? `Saved ${focusedVideo.uploadId}`
                  : null}
                {uploadStatus === "failed" ? "Upload failed" : null}
              </div>
            ) : null}
            {uploadError ? (
              <p className="border-t border-red-200 bg-red-50 px-2 py-2 text-xs leading-snug text-red-700">
                {uploadError}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <label
              aria-label="Upload video"
              className="flex aspect-[9/16] w-full cursor-pointer items-center justify-center bg-neutral-50 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
              htmlFor={videoInputId}
            >
              <span
                aria-hidden="true"
                className="text-4xl font-light leading-none"
              >
                +
              </span>
            </label>
            {uploadError ? (
              <p className="border-t border-red-200 bg-red-50 px-2 py-2 text-xs leading-snug text-red-700">
                {uploadError}
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
