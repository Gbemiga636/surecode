import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep tracing inside surecode/ so the parent monorepo lockfile is ignored
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["ccxt"],
};

export default nextConfig;
