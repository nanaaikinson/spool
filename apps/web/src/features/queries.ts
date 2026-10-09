import { QueryClient } from "@tanstack/react-query";
import {
  getOverviewQueryKey,
  getQueueQueryKey,
  getTaskQueryKey,
  listAuditQueryKey,
  listErrorGroupsQueryKey,
  listQueuesQueryKey,
  listSchedulersQueryKey,
  listServersQueryKey,
  listTasksQueryKey,
} from "../api/generated/@tanstack/react-query.gen";
import { errorCode } from "../api/client";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        count < 2 &&
        ![
          "AUTH_REQUIRED",
          "NOT_FOUND",
          "VALIDATION_ERROR",
          "INVALID_CURSOR",
        ].includes(errorCode(error)),
    },
    mutations: { retry: false },
  },
});
const keys = [
  getOverviewQueryKey(),
  listQueuesQueryKey(),
  listServersQueryKey(),
  listSchedulersQueryKey(),
  listTasksQueryKey(),
  listAuditQueryKey(),
  listErrorGroupsQueryKey(),
];
export function invalidateOperational() {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      if (typeof key !== "object" || key === null || !("_id" in key))
        return false;
      return (
        keys.some((k) => k[0]._id === key._id) ||
        key._id === getTaskQueryKey({ path: { queue: "", id: "" } })[0]._id ||
        key._id === getQueueQueryKey({ path: { queue: "" } })[0]._id
      );
    },
  });
}
