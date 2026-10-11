import { client } from "./generated/client.gen";
client.setConfig({
  baseUrl: "",
  credentials: "same-origin",
  headers: { "X-Spool-Action": "confirmed" },
});
export function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "The request failed. Check the connection and try again.";
}
export function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "";
}
