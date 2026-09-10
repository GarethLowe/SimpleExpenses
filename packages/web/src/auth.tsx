import { createContext, useContext, type ReactNode } from "react";
import { AuthProvider, useAuth, type AuthProviderProps } from "react-oidc-context";
import { WebStorageStateStore } from "oidc-client-ts";
import type { RuntimeConfig } from "./config";
import { ApiClient } from "./api";

const ConfigContext = createContext<RuntimeConfig | null>(null);
const ApiContext = createContext<ApiClient | null>(null);

export function useConfig(): RuntimeConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("Config not loaded");
  return c;
}

export function useApi(): ApiClient {
  const a = useContext(ApiContext);
  if (!a) throw new Error("API client not available");
  return a;
}

export function oidcProps(config: RuntimeConfig): AuthProviderProps {
  return {
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    scope: "openid email profile",
    response_type: "code",
    automaticSilentRenew: true,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    onSigninCallback: () => {
      // strip ?code=&state= so a refresh doesn't replay the callback
      window.history.replaceState({}, document.title, "/");
    },
  };
}

export function AppProviders({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  return (
    <ConfigContext.Provider value={config}>
      <AuthProvider {...oidcProps(config)}>
        <ApiBridge config={config}>{children}</ApiBridge>
      </AuthProvider>
    </ConfigContext.Provider>
  );
}

function ApiBridge({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const auth = useAuth();
  // The HTTP API JWT authoriser accepts Cognito access tokens (client_id claim).
  const api = new ApiClient(config.apiUrl, async () => {
    const user = auth.user;
    if (!user) return null;
    if (user.expired) {
      try {
        const renewed = await auth.signinSilent();
        return renewed?.access_token ?? null;
      } catch {
        return null;
      }
    }
    return user.access_token;
  });
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/** Cognito has no end_session_endpoint in its discovery document, so sign out by hand. */
export async function signOut(config: RuntimeConfig, removeUser: () => Promise<void>): Promise<void> {
  await removeUser();
  const url = new URL(`${config.cognitoDomain}/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("logout_uri", `${window.location.origin}/`);
  window.location.href = url.toString();
}
