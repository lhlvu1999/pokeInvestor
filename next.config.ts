import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Screenshot import sends up to 8 images (shrunk in the browser to a
      // few hundred KB each) in one request. The default 1 MB limit would
      // reject any batch. Per-image size is checked again on the server.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
