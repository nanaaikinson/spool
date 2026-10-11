import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../features/operations";
export const Route = createFileRoute("/settings")({ component: SettingsPage });
