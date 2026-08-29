"use client";

import { Markdown, type MarkdownProps } from "@truefoundry/trueforge-ui";

const MEDIA_API_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CLIPFORGE_API_BASE_URL ??
  "http://127.0.0.1:4000";

const CLIPFORGE_RENDER_URL_PATTERN =
  /(?:https?:\/\/[^\s<>)]+|sandbox:)?\/uploads\/[a-zA-Z0-9_-]+\/renders\/[a-zA-Z0-9_-]+\/file/g;
const CLIPFORGE_MARKDOWN_LINK_PATTERN =
  /\[[^\]]+\]\(((?:https?:\/\/[^\s<>)]+|sandbox:)?\/uploads\/[a-zA-Z0-9_-]+\/renders\/[a-zA-Z0-9_-]+\/file)\)/g;

type MarkdownSegment =
  | {
      text: string;
      type: "text";
    }
  | {
      type: "video";
      url: string;
    };

function resolveMediaUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const mediaPath = url.replace(/^sandbox:/, "");

  return `${MEDIA_API_BASE_URL.replace(/\/+$/, "")}/${mediaPath.replace(/^\/+/, "")}`;
}

function splitClipForgeRenderUrls(content: string): MarkdownSegment[] {
  const matches: Array<{ end: number; start: number; url: string }> = [];

  for (const match of content.matchAll(CLIPFORGE_MARKDOWN_LINK_PATTERN)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }

    matches.push({
      end: match.index + match[0].length,
      start: match.index,
      url: match[1],
    });
  }

  for (const match of content.matchAll(CLIPFORGE_RENDER_URL_PATTERN)) {
    const rawUrl = match[0];
    const index = match.index;

    if (index === undefined) {
      continue;
    }

    const overlapsMarkdownLink = matches.some(
      (existingMatch) =>
        index >= existingMatch.start && index < existingMatch.end,
    );

    if (overlapsMarkdownLink) {
      continue;
    }

    matches.push({
      end: index + rawUrl.length,
      start: index,
      url: rawUrl,
    });
  }

  matches.sort((first, second) => first.start - second.start);

  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({
        text: content.slice(cursor, match.start),
        type: "text",
      });
    }

    segments.push({
      type: "video",
      url: resolveMediaUrl(match.url),
    });
    cursor = match.end;
  }

  if (cursor < content.length) {
    segments.push({
      text: content.slice(cursor),
      type: "text",
    });
  }

  return segments.length > 0 ? segments : [{ text: content, type: "text" }];
}

export function ClipForgeMarkdown(props: MarkdownProps) {
  const segments = splitClipForgeRenderUrls(props.content);
  const hasVideo = segments.some((segment) => segment.type === "video");

  if (!hasVideo) {
    return <Markdown {...props} />;
  }

  return (
    <div className={props.className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return segment.text.trim() ? (
            <Markdown {...props} content={segment.text} key={`text-${index}`} />
          ) : null;
        }

        return (
          <div
            className="my-3 overflow-hidden rounded-lg border border-border bg-primary-bg text-text-primary"
            key={`${segment.url}-${index}`}
          >
            <div className="border-b border-border px-3 py-2">
              <p className="text-xs font-semibold text-primary-button-bg">
                Render Preview
              </p>
            </div>
            <div className="bg-neutral-950">
              <video
                className="mx-auto aspect-[9/16] max-h-[32rem] w-full max-w-[20rem] bg-neutral-950 object-contain"
                src={segment.url}
                controls
                playsInline
                preload="metadata"
              />
            </div>
            <div className="border-t border-border px-3 py-2 text-xs">
              <a
                className="font-medium text-primary-button-bg underline-offset-2 hover:underline"
                href={segment.url}
                target="_blank"
                rel="noreferrer"
              >
                Open video
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
