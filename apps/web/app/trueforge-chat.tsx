"use client";

import { useMemo } from "react";
import {
  TrueForgeUI,
  type TrueForgeServerConfig,
} from "@truefoundry/trueforge-ui";

export function TrueForgeChat() {
  const server = useMemo<TrueForgeServerConfig>(
    () => ({
      type: "trueforge",
      baseUrl: "/trueforge",
    }),
    [],
  );

  return (
    <div style={{ height: "100dvh" }}>
      <TrueForgeUI
        server={server}
        layout="sidebar"
        theme={{
          brand: { name: "ClipForge" },
        }}
      />
    </div>
  );
}
