import type { NextConfig } from "next";

// `npm run export:birdpile` builds a static copy that birdpile serves under
// /prizmichael (see scripts/export-birdpile.mjs). Regular builds are unaffected.
const basePath = process.env.PRIZMICHAEL_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(process.env.PRIZMICHAEL_STATIC === "1" ? { output: "export" as const } : {}),
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
