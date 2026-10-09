import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
export const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Unavailable";
export const duration = (seconds: number) =>
  seconds < 1
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
export const plural = (n: number, unit: string) =>
  `${number(n)} ${unit}${n === 1 ? "" : "s"}`;
