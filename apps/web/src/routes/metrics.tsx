import { createFileRoute } from "@tanstack/react-router";
import { MetricsPage } from "../features/operations";
export const Route = createFileRoute("/metrics")({ component: MetricsPage });
