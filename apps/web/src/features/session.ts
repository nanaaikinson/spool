import { useQuery } from "@tanstack/react-query";
import { getSessionOptions } from "../api/generated/@tanstack/react-query.gen";
export const useSession = () =>
  useQuery({
    ...getSessionOptions(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
