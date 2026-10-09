import { test, expect } from "@playwright/test";
test("dark default, persisted light, queue inspection and confirmed archive/retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/queues");
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(10, 10, 10)",
  );
  await expect(
    page.getByRole("link", { name: "spool-e2e", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/queues-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch to light mode" })
    .first()
    .click();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "test-results/queues-light.png",
    fullPage: true,
  });
  await page.getByRole("radio", { name: /^Paused/ }).click();
  await expect(page).toHaveURL(/queue_status=paused/);
  await expect(
    page.getByRole("heading", { name: "No matching queues" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /^All/ }).click();
  await page.getByRole("link", { name: "spool-e2e", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "spool-e2e", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open explorer" }).click();
  await page.getByRole("combobox", { name: "State", exact: true }).click();
  await page.getByRole("option", { name: "pending", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/state=pending/);
  await page
    .getByRole("link", { name: "fixture:inspect", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Payload", exact: true }),
  ).toBeVisible();
  await expect(page.getByText('"amount": 1200')).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(page.locator(".page-heading .badge")).toHaveText("archived");
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await page.getByRole("button", { name: "Confirm run now" }).click();
  await expect(page.locator(".page-heading .badge")).toHaveText("pending");
  await page.screenshot({
    path: "test-results/task-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch to dark mode" })
    .first()
    .click();
  await page.screenshot({ path: "test-results/task-dark.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("scheduled summary, advanced filters and responsive themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/scheduled?queue=spool-e2e");
  await expect(
    page.getByRole("link", { name: "fixture:scheduled", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".summary-card")
      .filter({ hasText: "Scheduled workload" })
      .locator(".summary-value"),
  ).toHaveText("1");
  await page.screenshot({
    path: "test-results/scheduled-dark.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("textbox", { name: "Task ID", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filterPanel = await page
    .getByRole("button", { name: "Filter", exact: true })
    .getAttribute("aria-controls");
  expect(filterPanel).toBeTruthy();
  await expect(page.locator(`[id="${filterPanel}"]`)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Task ID", exact: true })
    .fill("fixture-scheduled");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page).toHaveURL(/id=fixture-scheduled/);
  await expect(
    page.getByRole("link", { name: "fixture:scheduled", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Task ID", exact: true }),
  ).toHaveValue("fixture-scheduled");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Task ID", exact: true }),
  ).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/scheduled-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch to light mode" })
    .last()
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect(
    page.getByRole("button", { name: "Filter", exact: true }),
  ).toHaveCSS("color", "rgb(32, 32, 32)");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({
    path: "test-results/scheduled-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("failure presets, keyboard palette, bounded non-JSON display and mobile layout", async ({
  page,
}) => {
  await page.goto("/failures?queue=spool-e2e");
  await expect(
    page.getByRole("link", { name: "fixture:inspect", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "fixture:inspect", exact: true })
    .first()
    .click();
  await expect(page.locator(".page-heading .badge")).toHaveText("archived");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder("Search queues and views…").fill("Scheduled");
  await page.getByRole("option", { name: "Scheduled", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scheduled tasks" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "fixture:scheduled", exact: true })
    .click();
  await expect(page.locator("pre.payload")).toHaveText("plain text");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Toggle navigation" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/task-mobile.png",
    fullPage: true,
  });
});
test("signed session login, logout and viewer restrictions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8189/queues");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("admin");
  await page.locator("input[type=password]").fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page.locator("input[type=password]").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Queues", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("viewer");
  await page.locator("input[type=password]").fill("test-viewer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "spool-e2e", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause queue" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("saved filters can be restored and deleted", async ({ page }) => {
  const name = `Browser view ${Date.now()}`;
  await page.goto("/tasks?queue=spool-e2e&state=scheduled");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("   ");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await expect(page.getByText("Enter a view name.")).toBeVisible();
  await page.getByRole("textbox", { name: "View name" }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/settings");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/queue=spool-e2e/);
  await expect(page).toHaveURL(/state=scheduled/);
  await expect(
    page.getByRole("link", { name: "fixture:scheduled" }),
  ).toBeVisible();
  await page.goto("/settings");
  await page
    .getByRole("button", { name: `Delete ${name}`, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete view", exact: true })
    .click();
  await expect(page.getByRole("link", { name, exact: true })).not.toBeVisible();
});

test("shadcn Select keyboard control, URL restoration, and field validation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tasks");
  const queue = page.getByRole("combobox", { name: "Queue", exact: true });
  await queue.click();
  await page.getByRole("option", { name: "spool-e2e", exact: true }).click();
  const state = page.getByRole("combobox", { name: "State", exact: true });
  await state.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "All inspectable states", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "pending", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(state).toHaveText("pending");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page).toHaveURL(/queue=spool-e2e/);
  await expect(page).toHaveURL(/state=pending/);
  await page.reload();
  await expect(queue).toHaveText("spool-e2e");
  await expect(state).toHaveText("pending");
  await state.click();
  await page.getByRole("option", { name: "aggregating", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter a group for aggregating tasks.",
  );
  await expect(
    page.getByRole("textbox", { name: "Group", exact: true }),
  ).toBeVisible();
  await state.click();
  await page
    .getByRole("option", { name: "All inspectable states", exact: true })
    .click();
  await queue.click();
  await page.getByRole("option", { name: "All queues", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page).not.toHaveURL(/queue=|state=|all/);
  await state.click();
  await page.getByRole("option", { name: "completed", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /^Completed/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("tabpanel", { name: /^Completed/ }),
  ).toBeVisible();
  await page.goto("/metrics");
  await page.getByRole("combobox", { name: "Historical time range" }).click();
  await page.getByRole("option", { name: "Last 6 hours", exact: true }).click();
  await expect(page).toHaveURL(/range=6h/);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Historical time range" }),
  ).toHaveText("Last 6 hours");
  expect(errors).toEqual([]);
});

test("shadcn checkbox, confirmation cancellation, form dialog, and mobile Sheet", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tasks?queue=spool-e2e&state=pending");
  await page
    .getByRole("checkbox", { name: "Select this page", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Select fixture-1", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Archive selected", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(
    confirm.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await page
    .getByRole("link", { name: "fixture:inspect", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Clone task", exact: true }).click();
  const clone = page.getByRole("dialog");
  await expect(clone).toBeVisible();
  await clone.getByRole("textbox", { name: "Queue", exact: true }).fill("");
  await clone.getByRole("button", { name: "Confirm and enqueue" }).click();
  await expect(clone.getByRole("alert")).toBeVisible();
  await clone.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "Queues", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Queues", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  expect(errors).toEqual([]);
});
