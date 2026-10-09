import { describe, expect, it } from "vitest";
import { describeCron } from "./cron";
describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/5 * * * *", "Every 5 minutes"],
    ["0 * * * *", "Every hour"],
    ["15 * * * *", "Every hour at :15"],
    ["0 */6 * * *", "Every 6 hours at :00"],
    ["30 9 * * *", "At 09:30 every day"],
    ["0 9,17 * * 1-5", "At 09:00 and 17:00 on Monday through Friday"],
    ["0 0 1 * *", "At 00:00 on the 1st of the month"],
    ["0 8 * 1,7 0", "At 08:00 on Sunday, in January and July"],
    ["0 8 * * 7", "At 08:00 on Sunday"],
    ["@daily", "At 00:00 every day"],
    ["@hourly", "Every hour"],
    ["@every 1m", "Every minute"],
    ["@every 1h30m", "Every 1 hour 30 minutes"],
    ["@every 45s", "Every 45 seconds"],
    ["CRON_TZ=Africa/Accra 0 6 * * *", "At 06:00 every day"],
  ])("%s → %s", (spec, text) => {
    expect(describeCron(spec)).toBe(text);
  });
  it("returns null for expressions outside the supported subset", () => {
    expect(describeCron("0-10 * * * *")).toBeNull();
    expect(describeCron("0 0 * * MON")).toBeNull();
    expect(describeCron("@every soon")).toBeNull();
    expect(describeCron("not a cron")).toBeNull();
  });
});
