import { createContext, useContext } from "react";

export interface Session {
  /** True when the user holds the API token and may mutate monitors. */
  canWrite: boolean;
}

const SessionContext = createContext<Session>({ canWrite: false });

export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
  return useContext(SessionContext);
}
