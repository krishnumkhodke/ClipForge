import { dirname, resolve } from "node:path";
import process from "node:process";
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
      {
        source: "/clipforge-api/:path*",
        destination: `${
          process.env.MEDIA_API_BASE_URL ??
          process.env.CLIPFORGE_API_BASE_URL ??
          "http://127.0.0.1:4000"
        }/:path*`,
      },
    ];
  },
};

export default nextConfig;
