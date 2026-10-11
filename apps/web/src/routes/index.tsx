import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../features/queues";
export const Route = createFileRoute("/")({ component: OverviewPage });
