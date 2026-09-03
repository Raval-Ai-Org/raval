import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx"],
};

export default nextConfig;
