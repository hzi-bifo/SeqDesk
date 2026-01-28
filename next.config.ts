import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for distribution
  // Creates minimal deployment without node_modules
  output: "standalone",
};

export default nextConfig;
