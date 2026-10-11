import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "../features/tasks";
export const Route = createFileRoute("/scheduled")({
  component: () => <TasksPage preset="scheduled" />,
});
