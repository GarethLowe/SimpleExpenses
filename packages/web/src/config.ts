export interface RuntimeConfig {
  region: string;
  apiUrl: string;
  userPoolId: string;
  clientId: string;
  cognitoDomain: string;
  issuer: string;
}

/**
 * Deployed builds read /config.json (written by the CDK stack). Local dev can
 * point at a deployed backend with VITE_* variables in packages/web/.env.local.
 */
export async function loadConfig(): Promise<RuntimeConfig> {
  const env = import.meta.env;
  if (env["VITE_API_URL"]) {
    const region = String(env["VITE_REGION"] ?? "eu-west-2");
    const userPoolId = String(env["VITE_USER_POOL_ID"] ?? "");
    return {
      region,
      apiUrl: String(env["VITE_API_URL"]),
      userPoolId,
      clientId: String(env["VITE_CLIENT_ID"] ?? ""),
      cognitoDomain: String(env["VITE_COGNITO_DOMAIN"] ?? ""),
      issuer: String(env["VITE_ISSUER"] ?? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`),
    };
  }
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load /config.json (${res.status}). Has the stack been deployed?`);
  return (await res.json()) as RuntimeConfig;
}
