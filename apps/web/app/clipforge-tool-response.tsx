"use client";

import {
  ToolCallContentBlock,
  type ToolCallContentBlockProps,
} from "@truefoundry/trueforge-ui";

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

  return `${MEDIA_API_BASE_URL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
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

export function ClipForgeToolCallContentBlock(
  props: ToolCallContentBlockProps,
) {
  const renderResult =
    props.title === "Response" ? getClipForgeRenderResult(props.content) : null;

  if (!renderResult) {
    return <ToolCallContentBlock {...props} />;
  }

  const { render } = renderResult;
  const size = formatBytes(render.byteLength);

  return (
    <div
      className={props.className}
      data-content={props.content}
      data-testid={
        props.dataTestPrefix
          ? `${props.dataTestPrefix}-clipforge-preview`
          : "clipforge-render-preview"
      }
    >
      <div className="overflow-hidden rounded-lg border border-border bg-primary-bg text-text-primary">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-primary-button-bg">
            Render Preview
          </p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">
            {render.clip?.title ?? render.id ?? "ClipForge render"}
            {size ? ` · ${size}` : ""}
          </p>
        </div>
        <div className="bg-neutral-950">
          <video
            className="mx-auto aspect-[9/16] max-h-[28rem] w-full max-w-[18rem] bg-neutral-950 object-contain"
            src={render.publicUrl}
            controls
            playsInline
            preload="metadata"
          />
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
            <summary className="cursor-pointer select-none">Response JSON</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-2 py-1 text-[11px] leading-4">
              {props.content}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
