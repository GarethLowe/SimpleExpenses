import type { PreSignUpTriggerEvent } from "aws-lambda";

/**
 * Cognito pre-sign-up trigger. Federated (Google/Apple) sign-ins create a user
 * on first login, so this is the one place to restrict who can use the app:
 * ALLOWED_EMAILS is a comma-separated allowlist; empty means anyone.
 */
export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  return applyAllowlist(event, process.env["ALLOWED_EMAILS"] ?? "");
};

export function applyAllowlist(event: PreSignUpTriggerEvent, allowedEmails: string): PreSignUpTriggerEvent {
  const allowed = allowedEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = (event.request.userAttributes["email"] ?? "").trim().toLowerCase();
  if (allowed.length > 0 && !allowed.includes(email)) {
    throw new Error("This email address is not allowed to sign up");
  }
  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    event.response.autoConfirmUser = true;
    if (email) event.response.autoVerifyEmail = true;
  }
  return event;
}
