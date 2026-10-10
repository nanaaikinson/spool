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

// Organization selection belongs to the tab. Cookies are shared across tabs.
export function selectedOrganization(): string | null {
  return sessionStorage.getItem("spool.organization");
}
export function selectOrganization(id: string | null) {
  if (id) sessionStorage.setItem("spool.organization", id);
  else sessionStorage.removeItem("spool.organization");
}
client.interceptors.request.use((request) => {
  const id = selectedOrganization();
  if (id && !request.headers.has("X-Spool-Organization"))
    request.headers.set("X-Spool-Organization", id);
  return request;
});
