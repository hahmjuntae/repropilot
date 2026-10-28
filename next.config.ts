import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/run": ["./examples/**/*"],
  },
};

export default nextConfig;
