import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
export const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Unavailable";
export const duration = (seconds: number) =>
  seconds <= 0
    ? "0s"
    : seconds < 1
      ? `${Math.round(seconds * 1000)}ms`
      : seconds < 60
        ? `${number(seconds)}s`
        : seconds < 3600
          ? `${number(seconds / 60)}m`
          : `${number(seconds / 3600)}h`;
export const bytes = (value: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${number(n)} ${units[i]}`;
};
export const plural = (n: number, unit: string, many = `${unit}s`) =>
  `${number(n)} ${n === 1 ? unit : many}`;
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Color hint for an environment name: red for production, amber for staging. */
export const envTone = (env: string) =>
  /prod/i.test(env) ? "production" : /stag/i.test(env) ? "staging" : "other";
