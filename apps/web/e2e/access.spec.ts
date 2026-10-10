import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8190";

test("browser setup, organization switching, member roles and account revocation", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Set up your organization" }),
  ).toBeVisible();
  await page
    .getByLabel("Setup token")
    .fill("isolated-browser-setup-token-1234567890");
  await page
    .getByLabel("Organization name", { exact: true })
    .fill("Alpha team");
  await page.getByLabel("Administrator username").fill("owner");
  await page.getByLabel("Administrator password").fill("long-owner-password");
  await page.getByRole("button", { name: "Complete setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-owner-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Organization", { exact: true })).toContainText(
    "Alpha team",
  );
  const session = await (
    await page.request.get(`${origin}/api/v1/session`)
  ).json();
  const firstOrganization = session.organization.id;
  await page.request.post(`${origin}/api/v1/views`, {
    headers: { "X-Spool-Action": "confirmed" },
    data: { name: "Alpha private view", path: "/tasks" },
  });
  await page.goto(`${origin}/settings`);
  await expect(
    page.getByText("Alpha private view", { exact: true }),
  ).toBeVisible();
  const create = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", {
      name: "Create organization",
      exact: true,
    }),
  });
  await create.getByLabel("Organization name").fill("Beta team");
  const redis = new URL(
    process.env.SPOOL_TEST_REDIS ?? "redis://127.0.0.1:6388/15",
  );
  redis.pathname = "/14";
  await create.getByLabel("Asynq Redis URL").fill(redis.toString());
  await create
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await expect(page.getByLabel("Organization", { exact: true })).toContainText(
    "Beta team",
  );
  const orgs = await (
    await page.request.get(`${origin}/api/v1/organizations`)
  ).json();
  const beta = orgs.data.find((o: { name: string }) => o.name === "Beta team");
  const alphaTab = await page.context().newPage();
  await alphaTab.goto(`${origin}/settings`);
  await expect(
    alphaTab.getByLabel("Organization", { exact: true }),
  ).toHaveValue(firstOrganization);
  await page.getByLabel("Organization", { exact: true }).selectOption(beta.id);
  await expect(page).toHaveURL(`${origin}/`);
  await page.goto(`${origin}/settings`);
  await expect(
    page.getByText("Alpha private view", { exact: true }),
  ).toHaveCount(0);
  // Cookie selection changed to Beta; the other tab must still read and mutate Alpha.
  await alphaTab.reload();
  await expect(
    alphaTab.getByText("Alpha private view", { exact: true }),
  ).toBeVisible();
  await alphaTab
    .getByRole("button", { name: "Delete Alpha private view", exact: true })
    .click();
  await expect(alphaTab.getByRole("alertdialog")).toContainText("Alpha team");
  await alphaTab
    .getByRole("button", { name: "Delete view", exact: true })
    .click();
  await expect(
    alphaTab.getByText("Alpha private view", { exact: true }),
  ).toHaveCount(0);
  await alphaTab.close();
  const members = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", {
      name: "Organization members",
      exact: true,
    }),
  });
  await members.getByLabel("Member username").fill("observer");
  await members
    .getByLabel("New account password (optional)")
    .fill("long-observer-password");
  await members.getByLabel("Organization role").selectOption("operator");
  await members
    .getByRole("button", { name: "Add member", exact: true })
    .click();
  await expect(members.getByText("observer", { exact: true })).toBeVisible();
  const operatorContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto(origin);
  await operatorPage.getByLabel("Username", { exact: true }).fill("observer");
  await operatorPage
    .getByLabel("Password", { exact: true })
    .fill("long-observer-password");
  await operatorPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    operatorPage.getByLabel("Organization", { exact: true }),
  ).toContainText("Beta team");
  await operatorPage.goto(`${origin}/tasks`);
  await expect(
    operatorPage.getByRole("button", { name: "Save view", exact: true }),
  ).toBeEnabled();
  const role = page.getByLabel("Role for observer");
  await role.selectOption("viewer");
  await role.locator("..").getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Beta team");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(role).toHaveValue("viewer");
  await expect(
    page
      .locator("#organization-access")
      .getByLabel("Organization name", { exact: true })
      .first(),
  ).toBeFocused();
  await operatorPage.reload();
  await expect(
    operatorPage.getByRole("button", { name: "Save view", exact: true }),
  ).toBeDisabled();
  await operatorContext.close();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/access-settings-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/access-settings-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  const csrf = { "X-Spool-Action": "confirmed" };
  await page.request.delete(`${origin}/api/v1/session`, {
    headers: csrf,
    data: { confirm: true },
  });
  await page.reload();
  await page.getByLabel("Username", { exact: true }).fill("observer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-observer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Organization", { exact: true })).toContainText(
    "Beta team",
  );
  await expect(
    page.getByLabel("Organization", { exact: true }),
  ).not.toContainText("Alpha team");
  await page.goto(`${origin}/settings`);
  await expect(
    page.getByRole("heading", { name: "Organization members", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Deployment accounts", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Create organization", exact: true }),
  ).toHaveCount(0);
  const denied = await page.request.get(`${origin}/api/v1/queues`, {
    headers: { "X-Spool-Organization": firstOrganization },
  });
  expect(denied.status()).toBe(401);
  await page.getByLabel("Current password").fill("long-observer-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("changed-observer-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
