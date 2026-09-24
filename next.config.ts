import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.3.54", "127.0.0.1", "localhost"],
  agentRules: false,
};

export default nextConfig;
