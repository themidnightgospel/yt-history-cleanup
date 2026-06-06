import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sapisidHash,
  readCookie,
  readYtcfg,
  assertFeedbackProcessed,
  deleteHistoryItem,
  ORIGIN,
  INNERTUBE_FEEDBACK,
} from "./api.js";

const TEST_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "FOO",
  "X",
  "SAPISIDX",
];

function setCookie(name: string, value: string, secure = false): void {
  document.cookie = `${name}=${value}; Path=/${secure ? "; Secure" : ""}`;
}

function expireAllTestCookies(): void {
  for (const name of TEST_COOKIE_NAMES) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure`;
  }
}

beforeEach(() => {
  expireAllTestCookies();
  window.ytcfg = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("readCookie", () => {
  it("returns value of named cookie", () => {
    setCookie("FOO", "bar");
    expect(readCookie("FOO")).toBe("bar");
  });

  it("URL-decodes the cookie value", () => {
    setCookie("X", "hello%20world");
    expect(readCookie("X")).toBe("hello world");
  });

  it("returns null when cookie is absent", () => {
    expect(readCookie("NOPE")).toBeNull();
  });

  it("does not match a prefix of another cookie name", () => {
    setCookie("SAPISIDX", "evil");
    expect(readCookie("SAPISID")).toBeNull();
  });
});

describe("readYtcfg", () => {
  it("returns empty object when ytcfg absent", () => {
    expect(readYtcfg()).toEqual({});
  });

  it("returns data_ when ytcfg is set", () => {
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "KEY" } };
    expect(readYtcfg().INNERTUBE_API_KEY).toBe("KEY");
  });
});

describe("sapisidHash", () => {
  it("produces deterministic hash for fixed time + cookie + origin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setCookie("SAPISID", "abc");
    const hash = await sapisidHash(ORIGIN);
    // 2026-01-01T00:00:00Z = epoch seconds 1767225600
    expect(hash.startsWith("1767225600_")).toBe(true);
    expect(hash).toMatch(/^1767225600_[0-9a-f]{40}$/);
  });

  it("falls back to __Secure-3PAPISID when SAPISID is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setCookie("__Secure-3PAPISID", "fallbackVal", true);
    const hash = await sapisidHash(ORIGIN);
    expect(hash).toMatch(/^1767225600_[0-9a-f]{40}$/);
  });

  it("throws when neither cookie is present", async () => {
    await expect(sapisidHash(ORIGIN)).rejects.toThrow(/SAPISID cookie not found/);
  });
});

describe("assertFeedbackProcessed", () => {
  function jsonRes(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("passes when isProcessed is true", async () => {
    await expect(
      assertFeedbackProcessed(jsonRes({ feedbackResponses: [{ isProcessed: true }] })),
    ).resolves.toBeUndefined();
  });

  it("throws when HTTP status is not ok", async () => {
    await expect(assertFeedbackProcessed(jsonRes({}, 500))).rejects.toThrow(/feedback HTTP 500/);
  });

  it("throws when isProcessed is false", async () => {
    await expect(
      assertFeedbackProcessed(jsonRes({ feedbackResponses: [{ isProcessed: false }] })),
    ).rejects.toThrow(/feedback not processed/);
  });

  it("throws when feedbackResponses is empty", async () => {
    await expect(assertFeedbackProcessed(jsonRes({}))).rejects.toThrow(/feedback not processed/);
  });
});

describe("deleteHistoryItem", () => {
  it("throws when INNERTUBE_API_KEY is missing", async () => {
    window.ytcfg = { data_: {} };
    setCookie("SAPISID", "abc");
    await expect(deleteHistoryItem("TOKEN")).rejects.toThrow(/INNERTUBE_API_KEY not found/);
  });

  it("posts to the feedback endpoint with the token and asserts processed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    window.ytcfg = {
      data_: {
        INNERTUBE_API_KEY: "TEST_KEY",
        INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.99" } },
      },
    };
    setCookie("SAPISID", "abc");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(deleteHistoryItem("TOK_42")).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${INNERTUBE_FEEDBACK}?key=TEST_KEY&prettyPrint=false`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.feedbackTokens).toEqual(["TOK_42"]);
    expect(body.context.client.clientVersion).toBe("2.99");
    expect((init?.headers as Record<string, string>)["Authorization"]).toMatch(
      /^SAPISIDHASH 1767225600_[0-9a-f]{40}$/,
    );
  });
});
