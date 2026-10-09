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
