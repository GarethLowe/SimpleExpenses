import type { PreSignUpTriggerEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { applyAllowlist } from "../src/handlers/preSignUp.js";

function ev(email: string, triggerSource = "PreSignUp_ExternalProvider"): PreSignUpTriggerEvent {
  return {
    triggerSource,
    request: { userAttributes: { email }, validationData: {} },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  } as unknown as PreSignUpTriggerEvent;
}

describe("applyAllowlist", () => {
  it("allows everyone when the list is empty", () => {
    expect(applyAllowlist(ev("a@b.com"), "").response.autoConfirmUser).toBe(true);
  });
  it("allows listed emails case-insensitively and rejects others", () => {
    expect(() => applyAllowlist(ev("Me@Example.com"), " me@example.com, other@x.io")).not.toThrow();
    expect(() => applyAllowlist(ev("nope@example.com"), "me@example.com")).toThrow(/not allowed/);
  });
  it("does not auto-confirm native sign-ups", () => {
    const out = applyAllowlist(ev("a@b.com", "PreSignUp_SignUp"), "");
    expect(out.response.autoConfirmUser).toBe(false);
  });
});
