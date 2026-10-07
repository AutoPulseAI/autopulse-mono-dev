import path from "path";
import { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow HMR when opening dev server via LAN IP (e.g. http://192.168.1.7:3001)
  allowedDevOrigins: ["192.168.1.7", "localhost", "127.0.0.1", "*.trycloudflare.com", "*.ngrok-free.dev"],

  // Turbopack configuration (Next.js 16+)
  turbopack: {
    resolveAlias: {
      "@": path.resolve(__dirname),
    },
  },

  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname),
    };
    return config;
  },
  
  typescript: {
    ignoreBuildErrors: true,
  },
 
  images: {
    domains: [], // Add external domains if needed
    formats: ['image/avif', 'image/webp'], // Modern formats
    deviceSizes: [640, 750, 828, 1080, 1200, 1920], // Responsive sizes
  },
 
};

export default nextConfig;
