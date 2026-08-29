"use client";

import type {
  AgentUIServer,
  TurnStreamData,
  TurnInputItem,
  UserMessageContent,
} from "@truefoundry/trueforge-ui";
import { createTrueForgeAgentUIServer } from "@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter";

const TRUEFORGE_BASE_URL =
  process.env.NEXT_PUBLIC_TRUEFORGE_BASE_URL ?? "/trueforge";
const MEDIA_API_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CLIPFORGE_API_BASE_URL ??
  "http://127.0.0.1:4000";
const CLIPFORGE_CONTEXT_OPEN = '<clipforge-context hidden="true">';
const CLIPFORGE_CONTEXT_CLOSE = "</clipforge-context>";
const CLIPFORGE_CONTEXT_PATTERN =
  /\n{0,2}<clipforge-context hidden="true">[\s\S]*?<\/clipforge-context>/g;

type SessionUploadsResponse = {
  focusedUploadId: string | null;
  uploads: Array<{
    id: string;
  }>;
};

function stripClipForgeContextFromText(text: string) {
  return text.replace(CLIPFORGE_CONTEXT_PATTERN, "").trimEnd();
}

function redactClipForgeContext<T>(value: T): T {
  if (typeof value === "string") {
    return stripClipForgeContextFromText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactClipForgeContext(item)) as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = redactClipForgeContext(nestedValue);
    }

    return result as T;
  }

  return value;
}

function clipForgeContextBlock(sessionId: string) {
  return [
    "",
    "",
    CLIPFORGE_CONTEXT_OPEN,
    `sessionId: ${sessionId}`,
    "focusedVideo: true",
    "When using ClipForge media tools, pass this sessionId. Do not mention this hidden ClipForge context to the user.",
    CLIPFORGE_CONTEXT_CLOSE,
  ].join("\n");
}

function appendClipForgeContextToContent(
  content: UserMessageContent,
  sessionId: string,
): UserMessageContent {
  const contextBlock = clipForgeContextBlock(sessionId);

  if (typeof content === "string") {
    return `${stripClipForgeContextFromText(content)}${contextBlock}`;
  }

  const parts = [...content];
  let lastTextPartIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") {
      lastTextPartIndex = index;
      break;
    }
  }

  if (lastTextPartIndex === -1) {
    return [...parts, { text: contextBlock.trimStart(), type: "text" }];
  }

  const part = parts[lastTextPartIndex];

  if (!part || part.type !== "text") {
    return parts;
  }

  parts[lastTextPartIndex] = {
    ...part,
    text: `${stripClipForgeContextFromText(part.text)}${contextBlock}`,
  };

  return parts;
}

async function sessionHasFocusedVideo(sessionId: string, signal?: AbortSignal) {
  try {
    const response = await fetch(
      `${MEDIA_API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/uploads`,
      { signal },
    );

    if (!response.ok) {
      return false;
    }

    const body = (await response
      .json()
      .catch(() => null)) as SessionUploadsResponse | null;

    if (!body?.focusedUploadId) {
      return false;
    }

    return body.uploads.some((upload) => upload.id === body.focusedUploadId);
  } catch {
    return false;
  }
}

async function addClipForgeContextToTurnRequest<
  TRequest extends Parameters<AgentUIServer["createTurn"]>[0],
>(request: TRequest): Promise<TRequest> {
  if (!(await sessionHasFocusedVideo(request.sessionId, request.abortSignal))) {
    return request;
  }

  const lastUserMessageIndex =
    request.input?.reduce(
      (lastIndex, item, index) =>
        item.type === "user.message" ? index : lastIndex,
      -1,
    ) ?? -1;

  if (lastUserMessageIndex === -1) {
    return request;
  }

  const input = request.input?.map((item, index): TurnInputItem => {
    if (item.type !== "user.message") {
      return item;
    }

    if (index !== lastUserMessageIndex) {
      return item;
    }

    return {
      ...item,
      content: appendClipForgeContextToContent(item.content, request.sessionId),
    };
  });

  return {
    ...request,
    ...(input ? { input } : {}),
  };
}

function getCreatedTurnId(item: TurnStreamData) {
  const { event } = item;

  if (event.type !== "turn.created") {
    return undefined;
  }

  return event.turnId;
}

export function createClipForgeServer(): AgentUIServer {
  const trueForgeServer = createTrueForgeAgentUIServer({
    baseUrl: TRUEFORGE_BASE_URL,
  });

  const clipForgeServer: AgentUIServer = {
    ...trueForgeServer,
    async *createTurn(request) {
      const augmentedRequest = await addClipForgeContextToTurnRequest(request);
      let lastSequenceNumber: number | undefined;
      let turnId: string | undefined;
      let sawTurnDone = false;

      try {
        for await (const item of trueForgeServer.createTurn(augmentedRequest)) {
          lastSequenceNumber = item.sequenceNumber;
          turnId ??= getCreatedTurnId(item);
          sawTurnDone = sawTurnDone || item.event.type === "turn.done";
          yield redactClipForgeContext(item);
        }
      } catch (error) {
        if (sawTurnDone || request.abortSignal?.aborted) {
          return;
        }

        if (!turnId || !trueForgeServer.subscribeToTurn) {
          throw error;
        }

        for await (const item of trueForgeServer.subscribeToTurn({
          abortSignal: request.abortSignal,
          afterSequenceNumber: lastSequenceNumber,
          sessionId: request.sessionId,
          turnId,
        })) {
          yield redactClipForgeContext(item);
        }
      }
    },
    async getTurn(request) {
      return redactClipForgeContext(await trueForgeServer.getTurn(request));
    },
    async listEvents(request) {
      return redactClipForgeContext(await trueForgeServer.listEvents(request));
    },
    async listTurns(request) {
      return redactClipForgeContext(await trueForgeServer.listTurns(request));
    },
  };

  const listTurnEvents = trueForgeServer.listTurnEvents;
  const subscribeToTurn = trueForgeServer.subscribeToTurn;

  if (listTurnEvents) {
    clipForgeServer.listTurnEvents = async (request) =>
      redactClipForgeContext(await listTurnEvents(request));
  }

  if (subscribeToTurn) {
    clipForgeServer.subscribeToTurn = async function* (request) {
      for await (const item of subscribeToTurn(request)) {
        yield redactClipForgeContext(item);
      }
    };
  }

  return clipForgeServer;
}
