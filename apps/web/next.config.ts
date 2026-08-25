import type { NextConfig } from "next";

// サーバー専用。ブラウザは常に Web のオリジンとだけ通信し、/api/* は API へプロキシする（docs/requirements.md §6.3）
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  // TS ソースを直接 export しているワークスペースパッケージ
  transpilePackages: ["@dopamin/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
