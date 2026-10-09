const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DESCRIPTORS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};
const UNITS: Record<string, [string, number]> = {
  h: ["hour", 3600],
  m: ["minute", 60],
  s: ["second", 1],
};
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const list = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const isNumber = (field: string) => /^\d+$/.test(field);
const isNumberList = (field: string) => /^\d+(,\d+)*$/.test(field);
/** Go duration (as accepted by Asynq's "@every") to words: 1h30m → every 1 hour 30 minutes. */
function every(value: string) {
  const parts = [...value.matchAll(/(\d+)(h|m|s)/g)];
  if (!parts.length || parts.map((p) => p[0]).join("") !== value) return null;
  const words = parts
    .filter((p) => Number(p[1]) > 0)
    .map((p) => plural(Number(p[1]), UNITS[p[2]][0]));
  if (words.length === 1 && words[0].startsWith("1 "))
    return `Every ${words[0].slice(2)}`;
  return `Every ${words.join(" ")}`;
}
function names(field: string, table: string[], offset = 0) {
  return field.split(",").map((part) => {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range)
      return `${table[Number(range[1]) - offset]} through ${table[Number(range[2]) - offset]}`;
    return table[Number(part) - offset] ?? part;
  });
}
function validNames(field: string, size: number, offset = 0) {
  return (
    /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(field) &&
    field
      .split(/[,-]/)
      .every((n) => Number(n) - offset >= 0 && Number(n) - offset < size)
  );
}
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const pad = (n: string) => n.padStart(2, "0");
/**
 * Describes an Asynq periodic spec in plain English, or returns null when the
 * expression is outside the supported subset so callers show only the raw spec.
 */
export function describeCron(input: string): string | null {
  let spec = input.trim().replace(/^(CRON_)?TZ=\S+\s+/, "");
  if (spec.startsWith("@every ")) return every(spec.slice(7).trim());
  spec = DESCRIPTORS[spec] ?? spec;
  const fields = spec.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;
  let time: string;
  if (minute === "*" && hour === "*") time = "Every minute";
  else if (/^\*\/\d+$/.test(minute) && hour === "*")
    time = `Every ${plural(Number(minute.slice(2)), "minute")}`;
  else if (isNumber(minute) && hour === "*")
    time = minute === "0" ? "Every hour" : `Every hour at :${pad(minute)}`;
  else if (isNumber(minute) && /^\*\/\d+$/.test(hour))
    time = `Every ${plural(Number(hour.slice(2)), "hour")} at :${pad(minute)}`;
  else if (isNumber(minute) && isNumberList(hour))
    time = `At ${list(hour.split(",").map((h) => `${pad(h)}:${pad(minute)}`))}`;
  else return null;
  const days: string[] = [];
  if (dom !== "*") {
    if (!isNumberList(dom)) return null;
    days.push(
      `on the ${list(dom.split(",").map((d) => ordinal(Number(d))))} of the month`,
    );
  }
  if (dow !== "*") {
    // Cron allows both 0 and 7 for Sunday.
    const normalized = dow.replace(/\b7\b/g, "0");
    if (!validNames(normalized, 7)) return null;
    days.push(`on ${list(names(normalized, DAYS))}`);
  }
  if (month !== "*") {
    if (!validNames(month, 12, 1)) return null;
    days.push(`in ${list(names(month, MONTHS, 1))}`);
  }
  if (!days.length) return time.startsWith("At ") ? `${time} every day` : time;
  return `${time} ${days.join(", ")}`;
}
