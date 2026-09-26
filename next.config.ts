import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small; Vercel ignores it.
  output: "standalone",
  // Pin the tracing root so a lockfile in a parent dir isn't mistaken for the workspace root.
  outputFileTracingRoot: path.resolve("."),
  // Keep native/binary deps out of the bundle so their files resolve at runtime.
  serverExternalPackages: ["ffmpeg-static", "mongodb"],
  // Make sure the ffmpeg binary is traced into serverless bundles (Vercel).
  outputFileTracingIncludes: {
    "/api/transcribe": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
