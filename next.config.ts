import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.3.54"],
  agentRules: false,
};

export default nextConfig;
