import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "../features/live";
export const Route = createFileRoute("/live")({ component: LivePage });
