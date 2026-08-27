import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: resolve(appDir, "../.."),
  },
  async rewrites() {
    return [
      {
        source: "/trueforge/:path*",
        destination: `${process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
