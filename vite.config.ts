import { defineConfig } from "vitest/config";

const SERVER_PORT = 8787;
const PLAYTHROUGH_TIMEOUT_MS = 30_000;

export default defineConfig({
  base: "./",
  server: {
    host: process.env.KAMI_WEB_HOST ?? "0.0.0.0",
    port: 5173,
    proxy: { "/api": { target: `http://localhost:${SERVER_PORT}`, ws: true } },
  },
  test: {
    testTimeout: PLAYTHROUGH_TIMEOUT_MS,
    projects: [
      {
        extends: true,
        test: { name: "web", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] },
      },
    ],
  },
});
