/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // 生成静态站点到 out 目录
  experimental: {
    optimizePackageImports: ["@ckb-ccc/core", "@ckb-ccc/core/bundle"],
  },
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,

      fs: false, // simple workaround for the lumos.hd.keystore fs not found problem
    };

    return config;
  },
};

export default nextConfig;
