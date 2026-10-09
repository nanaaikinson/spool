import { lazy } from "react";
import type { z } from "zod";
import {
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { Shell } from "./shell";
import { searchSchema } from "./search";
const OverviewPage = lazy(() =>
  import("../features/queues").then((module) => ({
    default: module.OverviewPage,
  })),
);
const QueuePage = lazy(() =>
  import("../features/queues").then((module) => ({
    default: module.QueuePage,
  })),
);
const QueuesPage = lazy(() =>
  import("../features/queues").then((module) => ({
    default: module.QueuesPage,
  })),
);
const TaskPage = lazy(() =>
  import("../features/tasks").then((module) => ({ default: module.TaskPage })),
);
const TasksPage = lazy(() =>
  import("../features/tasks").then((module) => ({ default: module.TasksPage })),
);
const WorkersPage = lazy(() =>
  import("../features/operations").then((module) => ({
    default: module.WorkersPage,
  })),
);
const MetricsPage = lazy(() =>
  import("../features/operations").then((module) => ({
    default: module.MetricsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/operations").then((module) => ({
    default: module.SettingsPage,
  })),
);
const SchedulersPage = lazy(() =>
  import("../features/operations").then((module) => ({
    default: module.SchedulersPage,
  })),
);
import { Empty } from "../components/data-state";
const root = createRootRoute({
  component: Shell,
  validateSearch: (
    value: SearchSchemaInput & Partial<z.infer<typeof searchSchema>>,
  ) => searchSchema.parse(value),
  search: { middlewares: [stripSearchParams(searchSchema.parse({}))] },
  notFoundComponent: () => (
    <Empty title="Page not found">
      Use the navigation to open an operational view.
    </Empty>
  ),
});
const overview = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: OverviewPage,
});
const queues = createRoute({
  getParentRoute: () => root,
  path: "/queues",
  component: QueuesPage,
});
const queue = createRoute({
  getParentRoute: () => root,
  path: "/queues/$queue",
  component: QueuePage,
});
const tasks = createRoute({
  getParentRoute: () => root,
  path: "/tasks",
  component: () => <TasksPage />,
});
const task = createRoute({
  getParentRoute: () => root,
  path: "/tasks/$queue/$id",
  component: TaskPage,
});
const workers = createRoute({
  getParentRoute: () => root,
  path: "/workers",
  component: WorkersPage,
});
const scheduled = createRoute({
  getParentRoute: () => root,
  path: "/scheduled",
  component: () => <TasksPage preset="scheduled" />,
});
const failures = createRoute({
  getParentRoute: () => root,
  path: "/failures",
  component: () => <TasksPage preset="failed" />,
});
const metrics = createRoute({
  getParentRoute: () => root,
  path: "/metrics",
  component: MetricsPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: SettingsPage,
});
const schedulers = createRoute({
  getParentRoute: () => root,
  path: "/schedulers",
  component: SchedulersPage,
});
export const router = createRouter({
  routeTree: root.addChildren([
    overview,
    queues,
    queue,
    tasks,
    task,
    workers,
    scheduled,
    failures,
    metrics,
    settings,
    schedulers,
  ]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
