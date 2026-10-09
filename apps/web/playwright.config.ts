import { defineConfig } from "@playwright/test";
const redis = process.env.SPOOL_TEST_REDIS ?? "redis://127.0.0.1:6388/15";
const database =
  process.env.SPOOL_TEST_DATABASE ??
  "postgres://spool:spool-local@127.0.0.1:5448/spool?sslmode=disable";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "go run ./cmd/server",
      cwd: "../..",
      url: "http://127.0.0.1:8189/ready",
      reuseExistingServer: false,
      env: {
        ...process.env,
        REDIS_URL: redis,
        DATABASE_URL: database,
        SPOOL_ADDR: "127.0.0.1:8189",
        PROMETHEUS_URL: "",
        SPOOL_ADMIN_USER: "admin",
        SPOOL_ADMIN_PASSWORD: "test-admin-password",
        SPOOL_VIEWER_USER: "viewer",
        SPOOL_VIEWER_PASSWORD: "test-viewer-password",
        SPOOL_SESSION_KEY: "isolated-test-session-signing-key-123456",
        SPOOL_STATIC_DIR: "apps/web/dist",
      },
    },
    {
      command: "go run ./cmd/e2eseed && go run ./cmd/server",
      cwd: "../..",
      url: "http://127.0.0.1:8188/ready",
      reuseExistingServer: false,
      env: {
        ...process.env,
        SPOOL_TEST_REDIS: redis,
        REDIS_URL: redis,
        DATABASE_URL: database,
        SPOOL_ADDR: "127.0.0.1:8188",
        PROMETHEUS_URL: "",
        SPOOL_ADMIN_USER: "",
        SPOOL_ADMIN_PASSWORD: "",
        SPOOL_VIEWER_USER: "",
        SPOOL_VIEWER_PASSWORD: "",
      },
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort",
      url: "http://127.0.0.1:5188",
      reuseExistingServer: false,
      env: { ...process.env, SPOOL_API_PROXY: "http://127.0.0.1:8188" },
    },
  ],
});
