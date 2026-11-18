// A TikTok video's creator captions, printed with timestamps and exported as SRT.
//
// Cost: captions_only spends at most 1 credit, and nothing if the video has no captions.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node captions.mjs [TIKTOK_URL]
//       Video links (tiktok.com/@user/video/...) and share links (vm.tiktok.com/...) both work.
// Node 18 or newer. No dependencies.

import { randomUUID } from "node:crypto";

const API = "https://www.transcriptdock.com"; // always www: the apex domain redirects
const KEY = process.env.TRANSCRIPTDOCK_API_KEY;
if (!KEY) {
  console.error("Set TRANSCRIPTDOCK_API_KEY to your td_live_ key.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, { body, idempotencyKey, text = false } = {}) {
  const headers = { Authorization: `Bearer ${KEY}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `${res.status} ${data.error?.code ?? "HTTP_ERROR"}: ${data.error?.message ?? res.statusText}` +
        ` (request ${data.request_id ?? res.headers.get("x-request-id")})`,
    );
  }
  return text ? res.text() : res.json();
}

async function waitForJob(id, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api("GET", `/v1/jobs/${id}?wait=25`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} is still ${job.status}. Check it again later.`);
    await sleep(1000);
  }
}

const url = process.argv[2] ?? "https://www.tiktok.com/@tiktok/video/7680721699171601694";

const idempotencyKey = randomUUID(); // save it: replaying the same body with it costs nothing
console.error(`Idempotency-Key: ${idempotencyKey}`);

const created = await api("POST", "/v1/jobs", {
  idempotencyKey,
  body: {
    source: { url },
    mode: "captions_only", // never starts AI transcription
    max_credits: 1, // ignored for captions_only, kept so a switch to auto stays capped
  },
});

const job = await waitForJob(created.id);
if (job.status !== "succeeded") {
  console.error(`Job ${job.status}: ${job.error?.code} ${job.error?.message ?? ""}`);
  if (job.error?.code === "NO_CAPTIONS") {
    console.error("This video has no captions. auto-fallback.mjs runs AI transcription on paid plans.");
  }
  process.exit(1);
}

const transcript = await api("GET", `/v1/transcripts/${job.result_id}`);
console.error(`${transcript.source_origin}, language ${transcript.language}, timing ${transcript.timing_granularity}`);

// Times come straight from the caption cues, in seconds. Never estimate them.
for (const segment of transcript.segments) {
  console.log(`[${segment.start.toFixed(1)}s to ${segment.end.toFixed(1)}s] ${segment.text}`);
}

console.log("\n" + (await api("GET", `/v1/transcripts/${job.result_id}/export?format=srt`, { text: true })));
