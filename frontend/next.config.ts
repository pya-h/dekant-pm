import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack config (default bundler in Next.js 16)
  turbopack: {
    root: __dirname,
    resolveAlias: {
      // Node built-ins not needed in browser for Solana packages
      crypto: { browser: "crypto-browserify" },
    },
  },
  // Webpack fallback for production builds
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

export default nextConfig;
