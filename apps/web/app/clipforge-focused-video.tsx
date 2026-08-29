"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  ThreadRootShell,
  useAuiState,
  type ThreadRootShellProps,
} from "@truefoundry/trueforge-ui";

type FocusedVideo = {
  aspectRatio: number | null;
  name: string;
  uploadId: string | null;
  url: string;
};

type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";

type ThreadUploadState = {
  focusedVideo: FocusedVideo | null;
  uploadError: string | null;
  uploadStatus: UploadStatus;
};

type MediaUploadResponse = {
  upload: {
    id: string;
  };
};

type FocusedVideoContextValue = {
  getThreadUploadState: (threadKey: string) => ThreadUploadState;
  migrateThreadUploadState: (fromThreadKey: string, toThreadKey: string) => void;
  updateThreadUploadState: (
    threadKey: string,
    update: (current: ThreadUploadState) => ThreadUploadState,
  ) => void;
};

const EMPTY_THREAD_UPLOAD_STATE: ThreadUploadState = {
  focusedVideo: null,
  uploadError: null,
  uploadStatus: "idle",
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

const FocusedVideoContext = createContext<FocusedVideoContextValue | null>(
  null,
);

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

function revokeObjectUrl(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function useFocusedVideoContext() {
  const context = useContext(FocusedVideoContext);

  if (!context) {
    throw new Error(
      "ClipForge focused video components must be rendered inside ClipForgeFocusedVideoProvider.",
    );
  }

  return context;
}

export function ClipForgeFocusedVideoProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [uploadsByThreadKey, setUploadsByThreadKey] = useState<
    Record<string, ThreadUploadState>
  >({});
  const uploadsByThreadKeyRef = useRef(uploadsByThreadKey);

  useEffect(() => {
    uploadsByThreadKeyRef.current = uploadsByThreadKey;
  }, [uploadsByThreadKey]);

  useEffect(
    () => () => {
      for (const threadUpload of Object.values(uploadsByThreadKeyRef.current)) {
        if (threadUpload.focusedVideo) {
          revokeObjectUrl(threadUpload.focusedVideo.url);
        }
      }
    },
    [],
  );

  const getThreadUploadState = useCallback(
    (threadKey: string) =>
      uploadsByThreadKey[threadKey] ?? EMPTY_THREAD_UPLOAD_STATE,
    [uploadsByThreadKey],
  );

  const updateThreadUploadState = useCallback(
    (
      threadKey: string,
      update: (current: ThreadUploadState) => ThreadUploadState,
    ) => {
      setUploadsByThreadKey((currentUploads) => ({
        ...currentUploads,
        [threadKey]: update(
          currentUploads[threadKey] ?? EMPTY_THREAD_UPLOAD_STATE,
        ),
      }));
    },
    [],
  );

  const migrateThreadUploadState = useCallback(
    (fromThreadKey: string, toThreadKey: string) => {
      if (fromThreadKey === toThreadKey) {
        return;
      }

      setUploadsByThreadKey((currentUploads) => {
        const fromUpload = currentUploads[fromThreadKey];

        if (!fromUpload) {
          return currentUploads;
        }

        const nextUploads = { ...currentUploads };
        delete nextUploads[fromThreadKey];

        if (!currentUploads[toThreadKey]) {
          nextUploads[toThreadKey] = fromUpload;
        }

        return nextUploads;
      });
    },
    [],
  );

  const value = useMemo<FocusedVideoContextValue>(
    () => ({
      getThreadUploadState,
      migrateThreadUploadState,
      updateThreadUploadState,
    }),
    [getThreadUploadState, migrateThreadUploadState, updateThreadUploadState],
  );

  return (
    <FocusedVideoContext.Provider value={value}>
      {children}
    </FocusedVideoContext.Provider>
  );
}

function ClipForgeFocusedVideoPanel({
  threadKey,
  threadUpload,
}: {
  threadKey: string;
  threadUpload: ThreadUploadState;
}) {
  const { updateThreadUploadState } = useFocusedVideoContext();
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const uploadAttemptsRef = useRef<Record<string, number>>({});
  const videoInputId = useId();
  const focusedVideo = threadUpload.focusedVideo;
  const focusedVideoAspectRatio =
    focusedVideo?.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO;
  const previewStyle = getPreviewStyle({
    aspectRatio: focusedVideoAspectRatio,
    hasError: Boolean(threadUpload.uploadError),
    hasFilename: Boolean(focusedVideo),
    hasStatus: Boolean(focusedVideo) && threadUpload.uploadStatus !== "idle",
    viewportHeight,
  });

  useEffect(() => {
    const updateViewportHeight = () => setViewportHeight(window.innerHeight);

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  const updateCurrentThreadUpload = useCallback(
    (update: (current: ThreadUploadState) => ThreadUploadState) => {
      updateThreadUploadState(threadKey, update);
    },
    [threadKey, updateThreadUploadState],
  );

  const isCurrentUploadAttempt = useCallback(
    (uploadThreadKey: string, uploadAttempt: number) =>
      uploadAttemptsRef.current[uploadThreadKey] === uploadAttempt,
    [],
  );

  const uploadVideoToMediaService = useCallback(
    async (file: File, uploadThreadKey: string, uploadAttempt: number) => {
      const formData = new FormData();
      formData.append("video", file);

      try {
        const response = await fetch(`${MEDIA_API_BASE_URL}/uploads`, {
          method: "POST",
          body: formData,
        });
        const body = (await response.json().catch(() => null)) as
          | MediaUploadResponse
          | { message?: string }
          | null;

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

        if (!isCurrentUploadAttempt(uploadThreadKey, uploadAttempt)) {
          return;
        }

        updateThreadUploadState(uploadThreadKey, (currentUpload) => ({
          ...currentUpload,
          focusedVideo: currentUpload.focusedVideo
            ? { ...currentUpload.focusedVideo, uploadId: body.upload.id }
            : currentUpload.focusedVideo,
          uploadError: null,
          uploadStatus: "uploaded",
        }));
      } catch (error) {
        if (!isCurrentUploadAttempt(uploadThreadKey, uploadAttempt)) {
          return;
        }

        updateThreadUploadState(uploadThreadKey, (currentUpload) => ({
          ...currentUpload,
          uploadError:
            error instanceof Error
              ? error.message
              : "The media service could not save this upload.",
          uploadStatus: "failed",
        }));
      }
    },
    [isCurrentUploadAttempt, updateThreadUploadState],
  );

  const handleVideoChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      const uploadThreadKey = threadKey;
      const uploadAttempt =
        (uploadAttemptsRef.current[uploadThreadKey] ?? 0) + 1;
      uploadAttemptsRef.current[uploadThreadKey] = uploadAttempt;

      if (!isLikelyVideoFile(file)) {
        updateCurrentThreadUpload((currentUpload) => ({
          ...currentUpload,
          uploadError: "Choose a video file such as MP4, MOV, or WebM.",
        }));
        event.target.value = "";
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        updateCurrentThreadUpload((currentUpload) => ({
          ...currentUpload,
          uploadError: "Videos must be 1 GB or smaller.",
        }));
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
        if (!isCurrentUploadAttempt(uploadThreadKey, uploadAttempt)) {
          revokeObjectUrl(url);
          cleanupMetadataVideo();
          return;
        }

        const hasDimensions =
          metadataVideo.videoWidth > 0 && metadataVideo.videoHeight > 0;

        if (!hasDimensions) {
          revokeObjectUrl(url);
          updateThreadUploadState(uploadThreadKey, (currentUpload) => ({
            ...currentUpload,
            uploadError:
              "This video has no readable dimensions. Choose another file.",
          }));
          cleanupMetadataVideo();
          return;
        }

        const previousVideo = threadUpload.focusedVideo;

        if (previousVideo) {
          revokeObjectUrl(previousVideo.url);
        }

        updateThreadUploadState(uploadThreadKey, () => ({
          focusedVideo: {
            aspectRatio: metadataVideo.videoWidth / metadataVideo.videoHeight,
            name: file.name,
            uploadId: null,
            url,
          },
          uploadError: null,
          uploadStatus: "uploading",
        }));
        cleanupMetadataVideo();
        void uploadVideoToMediaService(file, uploadThreadKey, uploadAttempt);
      };

      metadataVideo.onerror = () => {
        if (isCurrentUploadAttempt(uploadThreadKey, uploadAttempt)) {
          updateThreadUploadState(uploadThreadKey, (currentUpload) => ({
            ...currentUpload,
            uploadError:
              "This video could not be loaded. Try an MP4, MOV, or WebM file.",
          }));
        }

        revokeObjectUrl(url);
        cleanupMetadataVideo();
      };
      metadataVideo.src = url;

      event.target.value = "";
    },
    [
      isCurrentUploadAttempt,
      threadKey,
      threadUpload.focusedVideo,
      updateCurrentThreadUpload,
      updateThreadUploadState,
      uploadVideoToMediaService,
    ],
  );

  return (
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
                updateCurrentThreadUpload((currentUpload) => ({
                  ...currentUpload,
                  uploadError:
                    "This video cannot be played here. Choose a different file.",
                }))
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
          {threadUpload.uploadStatus !== "idle" ? (
            <div className="border-t border-black/10 px-2 py-1.5 text-xs text-neutral-500">
              {threadUpload.uploadStatus === "uploading"
                ? "Uploading..."
                : null}
              {threadUpload.uploadStatus === "uploaded" &&
              focusedVideo.uploadId
                ? `Saved ${focusedVideo.uploadId}`
                : null}
              {threadUpload.uploadStatus === "failed" ? "Upload failed" : null}
            </div>
          ) : null}
          {threadUpload.uploadError ? (
            <p className="border-t border-red-200 bg-red-50 px-2 py-2 text-xs leading-snug text-red-700">
              {threadUpload.uploadError}
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
          {threadUpload.uploadError ? (
            <p className="border-t border-red-200 bg-red-50 px-2 py-2 text-xs leading-snug text-red-700">
              {threadUpload.uploadError}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export const ClipForgeThreadRootShell = forwardRef<
  HTMLDivElement,
  ThreadRootShellProps
>(function ClipForgeThreadRootShell({ children, className, ...props }, ref) {
  const localThreadId = useAuiState((state) => state.threadListItem.id);
  const remoteSessionId = useAuiState(
    (state) => state.threadListItem.remoteId,
  );
  const threadKey = remoteSessionId ?? localThreadId;
  const {
    getThreadUploadState,
    migrateThreadUploadState,
  } = useFocusedVideoContext();

  useEffect(() => {
    if (remoteSessionId && remoteSessionId !== localThreadId) {
      migrateThreadUploadState(localThreadId, remoteSessionId);
    }
  }, [localThreadId, migrateThreadUploadState, remoteSessionId]);

  const threadUpload = getThreadUploadState(threadKey);

  return (
    <ThreadRootShell
      ref={ref}
      className={["relative", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
      <ClipForgeFocusedVideoPanel
        threadKey={threadKey}
        threadUpload={threadUpload}
      />
    </ThreadRootShell>
  );
});

ClipForgeThreadRootShell.displayName = "ClipForgeThreadRootShell";
