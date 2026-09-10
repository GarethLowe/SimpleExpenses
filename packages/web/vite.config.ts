import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Simple Expenses",
        short_name: "Expenses",
        description: "Capture receipts, extract them automatically, keep them organised.",
        theme_color: "#1f6f5f",
        background_color: "#f7f7f5",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/config\.json$/],
        runtimeCaching: [{ urlPattern: /\/config\.json$/, handler: "NetworkFirst" }],
      },
    }),
  ],
  build: { target: "es2022", sourcemap: true },
  server: { port: 5173 },
  test: { include: ["test/**/*.test.ts"] },
});
