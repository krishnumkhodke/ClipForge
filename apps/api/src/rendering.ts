import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipRenderPlan } from "./clip.js";

const compositionId = "ClipForgeClip";

type RenderClipOptions = {
  bundleDirectory: string;
  clip: ClipRenderPlan;
  outputPath: string;
  sourceUrl: string;
};

let bundledServeUrl: Promise<string> | undefined;

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getRemotionEntryPoint() {
  const compiledEntryPoint = fileURLToPath(
    new URL("./remotion/index.js", import.meta.url),
  );

  if (await pathExists(compiledEntryPoint)) {
    return compiledEntryPoint;
  }

  return fileURLToPath(new URL("./remotion/index.tsx", import.meta.url));
}

async function getBundledServeUrl(bundleDirectory: string) {
  bundledServeUrl ??= getRemotionEntryPoint().then((entryPoint) =>
    bundle({
      entryPoint,
      outDir: join(bundleDirectory, "remotion-bundle"),
      publicDir: null,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            ".js": [".js", ".ts", ".tsx"],
            ".jsx": [".jsx", ".tsx"],
          },
        },
      }),
    }),
  );

  return bundledServeUrl;
}

export async function renderClipToFile({
  bundleDirectory,
  clip,
  outputPath,
  sourceUrl,
}: RenderClipOptions) {
  const inputProps = {
    clip,
    sourceUrl,
  };
  const serveUrl = await getBundledServeUrl(bundleDirectory);
  const composition = await selectComposition({
    id: compositionId,
    inputProps,
    serveUrl,
  });

  await renderMedia({
    codec: "h264",
    composition,
    inputProps,
    logLevel: "warn",
    outputLocation: outputPath,
    overwrite: true,
    serveUrl,
  });
}
