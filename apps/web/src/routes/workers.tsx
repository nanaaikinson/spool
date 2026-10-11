import { createFileRoute } from "@tanstack/react-router";
import { WorkersPage } from "../features/operations";
export const Route = createFileRoute("/workers")({ component: WorkersPage });
