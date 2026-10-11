import { createFileRoute } from "@tanstack/react-router";
import { QueuePage } from "../../features/queues";
export const Route = createFileRoute("/queues/$queue")({
  component: QueuePage,
});
