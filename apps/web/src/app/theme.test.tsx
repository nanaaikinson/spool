import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./theme";
const bootstrap = readFileSync("public/theme.js", "utf8");
function Toggle() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>{theme}</button>;
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "";
  document.documentElement.className = "";
});
afterEach(cleanup);
describe("appearance preference", () => {
  it("defaults to dark before React mounts and persists light across reloads", () => {
    new Function(bootstrap)();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    render(
      <ThemeProvider>
        <Toggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("spool-theme")).toBe("light");
    new Function(bootstrap)();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("treats invalid stored preferences as dark", () => {
    localStorage.setItem("spool-theme", "system");
    new Function(bootstrap)();
    expect(document.documentElement).toHaveClass("dark");
  });
});
