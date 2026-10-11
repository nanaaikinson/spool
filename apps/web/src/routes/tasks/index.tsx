import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "../../features/tasks";
export const Route = createFileRoute("/tasks/")({
  component: () => <TasksPage />,
});
