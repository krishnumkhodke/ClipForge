"use client";

import { useMemo } from "react";
import {
  TrueForgeUI,
  type SlotOverrides,
} from "@truefoundry/trueforge-ui";
import { createClipForgeServer } from "./clipforge-server";
import {
  ClipForgeFocusedVideoProvider,
  ClipForgeThreadRootShell,
} from "./clipforge-focused-video";
import { ClipForgeMarkdown } from "./clipforge-markdown";
import { ClipForgeToolCallContentBlock } from "./clipforge-tool-response";

export function TrueForgeChat() {
  const server = useMemo(() => createClipForgeServer(), []);
  const overrides = useMemo<SlotOverrides>(
    () => ({
      Markdown: ClipForgeMarkdown,
      ThreadRootShell: ClipForgeThreadRootShell,
      ToolCallContentBlock: ClipForgeToolCallContentBlock,
    }),
    [],
  );

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <ClipForgeFocusedVideoProvider>
        <TrueForgeUI
          server={server}
          layout="sidebar"
          overrides={overrides}
          theme={{
            brand: { name: "ClipForge" },
          }}
        />
      </ClipForgeFocusedVideoProvider>
    </main>
  );
}
