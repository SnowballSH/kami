import { defineConfig } from "vitest/config";

const SERVER_PORT = 8787;
const PLAYTHROUGH_TIMEOUT_MS = 30_000;

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": { target: `http://localhost:${SERVER_PORT}`, ws: true } },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    testTimeout: PLAYTHROUGH_TIMEOUT_MS,
  },
});
