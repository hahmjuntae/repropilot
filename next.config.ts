import type { NextConfig } from "next";

// DEMO_EXPORT=1 빌드는 *.demo.tsx 만 페이지로 쓰는 정적 재생 데모, API 라우트 제외 기준
const demoExport = process.env.DEMO_EXPORT === "1";

const nextConfig: NextConfig = demoExport
  ? {
      output: "export",
      distDir: "out",
      pageExtensions: ["demo.tsx"],
      images: { unoptimized: true },
    }
  : {
      outputFileTracingIncludes: {
        "/api/run": ["./examples/**/*"],
      },
    };

export default nextConfig;
