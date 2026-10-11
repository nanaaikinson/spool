import type { z } from "zod";
import {
  createRootRoute,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { Shell } from "../app/shell";
import { searchSchema } from "../app/search";
import { Empty } from "../components/data-state";
export const Route = createRootRoute({
  component: Shell,
  validateSearch: (
    value: SearchSchemaInput & Partial<z.infer<typeof searchSchema>>,
  ) => searchSchema.parse(value),
  search: { middlewares: [stripSearchParams(searchSchema.parse({}))] },
  notFoundComponent: () => (
    <Empty title="Page not found">
      Check the address, or pick a page from the sidebar.
    </Empty>
  ),
});
