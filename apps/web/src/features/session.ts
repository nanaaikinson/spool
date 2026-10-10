import { useQuery } from "@tanstack/react-query";
import { getSessionOptions } from "../api/generated/@tanstack/react-query.gen";
import { getSession } from "../api/generated/sdk.gen";
import { selectedOrganization, selectOrganization } from "../api/client";
export const useSession = () =>
  useQuery({
    ...getSessionOptions(),
    queryFn: async ({ signal }) => {
      const fetch = async () =>
        (await getSession({ signal, throwOnError: true })).data;
      let session = await fetch();
      // A revoked membership must not strand an otherwise valid account.
      if (!session.authenticated && selectedOrganization()) {
        selectOrganization(null);
        session = await fetch();
      }
      selectOrganization(session.organization?.id ?? null);
      return session;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
