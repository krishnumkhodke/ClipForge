"use client";

import { useMemo } from "react";
import {
  TrueForgeUI,
  type SlotOverrides,
  type TrueForgeServerConfig,
} from "@truefoundry/trueforge-ui";
import {
  ClipForgeFocusedVideoProvider,
  ClipForgeThreadRootShell,
} from "./clipforge-focused-video";
import { ClipForgeMarkdown } from "./clipforge-markdown";
import { ClipForgeToolCallContentBlock } from "./clipforge-tool-response";

export function TrueForgeChat() {
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
