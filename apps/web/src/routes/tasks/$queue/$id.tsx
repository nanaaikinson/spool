import { createFileRoute } from "@tanstack/react-router";
import { TaskPage } from "../../../features/tasks";
export const Route = createFileRoute("/tasks/$queue/$id")({
  component: TaskPage,
});
