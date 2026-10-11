import { createFileRoute } from "@tanstack/react-router";
import { QueuesPage } from "../../features/queues";
export const Route = createFileRoute("/queues/")({ component: QueuesPage });
