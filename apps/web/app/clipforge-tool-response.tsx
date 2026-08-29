"use client";

import {
  Icon,
  ToolCallContentBlock,
  type ToolCallContentBlockProps,
} from "@truefoundry/trueforge-ui";
import { useState } from "react";

const MEDIA_API_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CLIPFORGE_API_BASE_URL ??
  "http://127.0.0.1:4000";

type ClipForgeRenderResult = {
  render: {
    byteLength?: number;
    clip?: {
      title?: string;
    };
    id?: string;
    mimeType?: string;
    publicUrl?: string;
    url?: string;
  };
};

function parseJsonFromToolContent(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return null;
  }

  const candidates = [
    trimmed,
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ];

  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) {
      continue;
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function resolveMediaUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const mediaPath = url.replace(/^sandbox:/, "");

  return `${MEDIA_API_BASE_URL.replace(/\/+$/, "")}/${mediaPath.replace(/^\/+/, "")}`;
}

function getClipForgeRenderResult(
  content: string,
): ClipForgeRenderResult | null {
  const parsed = parseJsonFromToolContent(content);

  if (!parsed || typeof parsed !== "object" || !("render" in parsed)) {
    return null;
  }

  const render = (parsed as { render?: unknown }).render;

  if (!render || typeof render !== "object") {
    return null;
  }

  const record = render as ClipForgeRenderResult["render"];
  const url = record.publicUrl ?? record.url;

  if (typeof url !== "string" || !url) {
    return null;
  }

  if (record.mimeType && record.mimeType !== "video/mp4") {
    return null;
  }

  return {
    render: {
      ...record,
      publicUrl: resolveMediaUrl(url),
    },
  };
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes <= 0) {
    return null;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RenderVideoPreview({
  fullscreen = false,
  render,
}: {
  fullscreen?: boolean;
  render: ClipForgeRenderResult["render"];
}) {
  return (
    <video
      className={
        fullscreen
          ? "mx-auto h-full max-h-full w-full bg-neutral-950 object-contain"
          : "mx-auto aspect-[9/16] max-h-[28rem] w-full max-w-[18rem] bg-neutral-950 object-contain"
      }
      src={render.publicUrl}
      controls
      playsInline
      preload="metadata"
    />
  );
}

export function ClipForgeToolCallContentBlock({
  className,
  content,
  contentHeightRem,
  contentRef,
  copyValue: providedCopyValue,
  dataTestPrefix,
  fullscreen,
  onFullscreenChange,
  resizable,
  title,
  ...props
}: ToolCallContentBlockProps) {
  const [copied, setCopied] = useState(false);
  const renderResult =
    title === "Response" ? getClipForgeRenderResult(content) : null;

  if (!renderResult) {
    return (
      <ToolCallContentBlock
        className={className}
        content={content}
        contentHeightRem={contentHeightRem}
        contentRef={contentRef}
        copyValue={providedCopyValue}
        dataTestPrefix={dataTestPrefix}
        fullscreen={fullscreen}
        onFullscreenChange={onFullscreenChange}
        resizable={resizable}
        title={title}
        {...props}
      />
    );
  }

  const { render } = renderResult;
  const size = formatBytes(render.byteLength);
  const copyValue = providedCopyValue ?? content;

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={className}
      data-content={content}
      data-testid={
        dataTestPrefix
          ? `${dataTestPrefix}-clipforge-preview`
          : "clipforge-render-preview"
      }
    >
      <div className="overflow-hidden rounded-lg border border-border bg-primary-bg text-text-primary">
        <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary-button-bg">
              Render Preview
            </p>
            <p className="mt-0.5 truncate text-xs text-text-secondary">
              {render.clip?.title ?? render.id ?? "ClipForge render"}
              {size ? ` - ${size}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-text-secondary">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors hover:text-text-primary"
              aria-label="Copy response"
            >
              <Icon name={copied ? "check" : "clone"} size={14} />
            </button>
            {onFullscreenChange ? (
              <button
                type="button"
                onClick={() => onFullscreenChange(true)}
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors hover:text-text-primary"
                aria-label="Expand preview"
              >
                <Icon name="expand-alt" size={14} />
              </button>
            ) : null}
          </div>
        </div>
        <div
          ref={contentRef}
          className="overflow-auto bg-neutral-950"
          style={
            resizable
              ? {
                  height:
                    contentHeightRem !== undefined
                      ? `${Math.min(contentHeightRem, 28)}rem`
                      : undefined,
                  resize: "vertical",
                }
              : undefined
          }
        >
          <RenderVideoPreview render={render} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs">
          <a
            className="font-medium text-primary-button-bg underline-offset-2 hover:underline"
            href={render.publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open video
          </a>
          <details className="text-text-secondary">
            <summary className="cursor-pointer select-none">
              Response JSON
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-2 py-1 text-[11px] leading-4">
              {content}
            </pre>
          </details>
        </div>
      </div>
      {fullscreen ? (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Render preview"
        >
          <div className="mb-3 flex items-center justify-between gap-3 text-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Render Preview</p>
              <p className="truncate text-xs text-white/70">
                {render.clip?.title ?? render.id ?? "ClipForge render"}
                {size ? ` - ${size}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onFullscreenChange?.(false)}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close preview"
            >
              <Icon name="compress" size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <RenderVideoPreview fullscreen render={render} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
