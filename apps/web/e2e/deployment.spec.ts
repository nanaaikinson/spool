import { expect, test } from "@playwright/test";
import type {
  DeploymentStatus,
  MetricHealth,
  Session,
} from "../src/api/generated/types.gen";

const session: Session = {
  authenticated: true,
  auth_required: true,
  actor: "admin",
  role: "admin",
  environment: "production",
  instance_name: "Acme operations",
  deployment_mode: "hosted",
  support_url: "https://support.example.com/spool",
  version: "test",
  read_only: false,
  read_only_reason: "",
};
const health: MetricHealth = {
  configured: true,
  available: true,
  scrape_status: "up",
  warming_up: true,
  message:
    "Collecting your first samples. Rate charts need at least two successful scrapes.",
};
const status: DeploymentStatus = {
  redis: {
    configured: true,
    available: true,
    message:
      "Connected, but no Asynq queues were found. Confirm the database matches your workers; a new environment may be empty.",
  },
  database: {
    configured: true,
    available: true,
    message:
      "Connected. Audit entries, saved views and schedule links have persistent storage.",
  },
  metrics: health,
  queue_count: 0,
  checked_at: new Date().toISOString(),
};

test("hosted diagnostics, first samples, empty queues and mobile identity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let checks = 0;
  let metrics = { ...health };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { data: [] };
    if (path === "/api/v1/session") data = session;
    if (path === "/api/v1/status") {
      checks++;
      data = { ...status, metrics };
    }
    if (path === "/api/v1/metrics") data = metrics;
    if (path === "/api/v1/overview")
      data = {
        queues: [],
        servers: 0,
        concurrency: 0,
        active_workers: 0,
        observed_at: new Date().toISOString(),
      };
    if (path === "/api/v1/audit") data = { data: [], total: 0 };
    if (path.startsWith("/api/v1/metrics/query"))
      data = {
        metric: "processed",
        unit: "attempts/s",
        source: "native-asynq-prometheus",
        data: [],
      };
    if (path === "/api/v1/events") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: connected\ndata: {}\n\n",
      });
      return;
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Connection status", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Collecting first samples", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact support" }).first(),
  ).toHaveAttribute("href", session.support_url);
  const section = page
    .locator('[data-slot="card"]')
    .filter({
      has: page.getByRole("heading", {
        name: "Connection status",
        exact: true,
      }),
    });
  metrics = {
    ...health,
    scrape_status: "down",
    warming_up: false,
    message: "Prometheus is reachable, but a Spool scrape is failing.",
  };
  await section.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Scrape failing", { exact: true })).toBeVisible();
  expect(checks).toBeGreaterThan(1);
  await page.screenshot({
    path: "test-results/deployment-settings-dark.png",
    fullPage: true,
  });
  metrics = { ...health };
  await page.goto("/metrics");
  await expect(
    page
      .getByRole("heading", {
        name: "Collecting your first samples",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  metrics = { ...health, warming_up: false };
  await page.reload();
  await expect(
    page
      .getByRole("heading", { name: "No samples in this range", exact: true })
      .first(),
  ).toBeVisible();
  await page.goto("/queues");
  await expect(
    page.getByRole("heading", { name: "No Asynq queues found", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator("header").getByText("Acme operations", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/deployment-queues-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("login uses runtime instance identity and hosted support, with self-hosted guidance", async ({
  page,
}) => {
  let metadata = { ...session, authenticated: false, actor: "", role: "" };
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({ json: metadata }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Use the account set up for Acme operations."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact support" }),
  ).toHaveAttribute("href", session.support_url);
  await expect(
    page.getByText(/private installation configuration/),
  ).not.toBeVisible();
  await page.screenshot({
    path: "test-results/deployment-login-hosted.png",
    fullPage: true,
  });
  metadata = { ...metadata, deployment_mode: "self-hosted", support_url: "" };
  await page.reload();
  await expect(
    page.getByText(/private installation configuration/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
