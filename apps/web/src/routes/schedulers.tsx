import { createFileRoute } from "@tanstack/react-router";
import { SchedulersPage } from "../features/operations";
export const Route = createFileRoute("/schedulers")({
  component: SchedulersPage,
});
