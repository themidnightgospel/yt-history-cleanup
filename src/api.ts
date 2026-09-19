export const ORIGIN = "https://www.youtube.com";
export const INNERTUBE_FEEDBACK = `${ORIGIN}/youtubei/v1/feedback`;

export type FeedbackResponse = {
  feedbackResponses?: Array<{ isProcessed?: boolean }>;
  actions?: unknown[];
};

export async function deleteHistoryItem(token: string): Promise<void> {
  await postFeedback(token);
}

// Signed POST of one feedbackToken to the official endpoint; see docs/adr/0001.
// Resolves with the parsed response (callers that need the undo token walk
// `actions`), rejects when the request fails or YouTube did not process it.
export async function postFeedback(token: string): Promise<FeedbackResponse> {
  const cfg = readYtcfg();
  const apiKey = cfg.INNERTUBE_API_KEY;
  const client = cfg.INNERTUBE_CONTEXT?.client ?? { clientName: "WEB", clientVersion: "2.0" };
  if (!apiKey) throw new Error("INNERTUBE_API_KEY not found");

  const hash = await sapisidHash(ORIGIN);

  const res = await fetch(`${INNERTUBE_FEEDBACK}?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SAPISIDHASH ${hash}`,
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": "0",
    },
    body: JSON.stringify({
      context: { client },
      feedbackTokens: [token],
    }),
  });

  return parseFeedbackResponse(res);
}

export async function assertFeedbackProcessed(res: Response): Promise<void> {
  await parseFeedbackResponse(res);
}

export async function parseFeedbackResponse(res: Response): Promise<FeedbackResponse> {
  if (!res.ok) throw new Error(`feedback HTTP ${res.status}`);
  const json = (await res.json()) as FeedbackResponse;
  const processed = json.feedbackResponses?.[0]?.isProcessed === true;
  if (!processed) throw new Error("feedback not processed");
  return json;
}

// SHA1(timestamp + " " + SAPISID + " " + origin); see docs/adr/0001.
export async function sapisidHash(origin: string): Promise<string> {
  const sapisid = readCookie("SAPISID") ?? readCookie("__Secure-3PAPISID");
  if (!sapisid) throw new Error("SAPISID cookie not found");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const input = `${timestamp} ${sapisid} ${origin}`;
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${timestamp}_${hex}`;
}

export function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function readYtcfg(): Ytcfg {
  return window.ytcfg?.data_ ?? {};
}
