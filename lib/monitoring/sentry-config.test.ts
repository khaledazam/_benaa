import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  isBrowserTranslationRemoveChildError,
  isRadixPortalRemoveChildError,
  isRadixPortalRemoveChildSentryEvent,
  scrubSentryEvent,
} from "./sentry-config";

function removeChildEvent(
  extra?: Partial<ErrorEvent>,
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "NotFoundError",
          value:
            "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        },
      ],
    },
    ...extra,
  } as ErrorEvent;
}

function safariRemoveChildEvent(extra?: Partial<ErrorEvent>): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "NotFoundError",
          value: "The object can not be found here.",
        },
      ],
    },
    contexts: {
      react: {
        componentStack: "removeChild@[native code]\nSelectPortal",
      },
    },
    ...extra,
  } as ErrorEvent;
}

describe("isBrowserTranslationRemoveChildError", () => {
  it('scrubs mixed-case request credentials, bodies, queries and personal identity', () => {
    const event = { type: undefined, request: { url: 'https://user:password@example.test/api?token=private-query', headers: { Authorization: 'Bearer private-token', Cookie: 'private-cookie' }, data: 'private-body', query_string: 'private-query' },
      user: { id: 'employee', email: 'private@example.test', username: 'private-name' }, extra: { password: 'private-password' },
      exception: { values: [{ type: 'Error', value: 'mongodb://user:pass@127.0.0.1/db' }] } } as ErrorEvent;
    const safe = JSON.stringify(scrubSentryEvent(event));
    for (const secret of ['private-query','private-token','private-cookie','private-body','private@example.test','private-name','private-password','user:pass']) expect(safe).not.toContain(secret);
    expect(safe).toContain('employee');
  });
  it("returns false for unrelated errors", () => {
    const event = {
      exception: { values: [{ type: "TypeError", value: "x" }] },
    } as ErrorEvent;
    expect(isBrowserTranslationRemoveChildError(event)).toBe(false);
  });

  it("returns true when breadcrumbs mention translated-ltr", () => {
    const event = removeChildEvent({
      breadcrumbs: [{ message: "UI Click → html.translated-ltr.dark" }],
    });
    expect(isBrowserTranslationRemoveChildError(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it("returns false for removeChild without translation signals", () => {
    const event = removeChildEvent();
    expect(isBrowserTranslationRemoveChildError(event)).toBe(false);
  });
});

describe("isRadixPortalRemoveChildError", () => {
  it("detects Safari removeChild NotFoundError message", () => {
    const err = new Error("The object can not be found here.");
    err.name = "NotFoundError";
    expect(isRadixPortalRemoveChildError(err)).toBe(true);
  });

  it("detects Chrome not-a-child removeChild message", () => {
    const err = new Error(
      "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    );
    err.name = "NotFoundError";
    expect(isRadixPortalRemoveChildError(err)).toBe(true);
  });

  it("detects via SelectPortal in componentStack", () => {
    const err = new Error("unknown");
    err.name = "NotFoundError";
    expect(
      isRadixPortalRemoveChildError(err, "at SelectPortal\nat SelectContent"),
    ).toBe(true);
  });

  it("returns false for unrelated TypeError", () => {
    expect(isRadixPortalRemoveChildError(new TypeError("x"))).toBe(false);
  });
});

describe("isRadixPortalRemoveChildSentryEvent", () => {
  it("scrubs Chrome removeChild without translate signals", () => {
    const event = removeChildEvent();
    expect(isRadixPortalRemoveChildSentryEvent(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it("scrubs Safari removeChild with SelectPortal stack", () => {
    const event = safariRemoveChildEvent();
    expect(isRadixPortalRemoveChildSentryEvent(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it("does not scrub unrelated TypeError events", () => {
    const event = {
      exception: { values: [{ type: "TypeError", value: "boom" }] },
    } as ErrorEvent;
    expect(isRadixPortalRemoveChildSentryEvent(event)).toBe(false);
    expect(scrubSentryEvent(event)).not.toBeNull();
  });
});
