// mode "auto" for TikTok: creator captions when they exist, AI transcription when they do not.
//
// Cost: 1 credit with captions. Otherwise AI transcription at 2 credits per started minute,
//       60 second minimum. MAX_CREDITS (default 6) caps it: 6 covers up to 3 minutes.
//       Longer videos fail with BUDGET_EXCEEDED and nothing is charged. Paid plans only.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node auto-fallback.mjs TIKTOK_URL [MAX_CREDITS]
// Node 18 or newer. No dependencies.

import { randomUUID } from "node:crypto";

const API = "https://www.transcriptdock.com";
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

async function waitForJob(id, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api("GET", `/v1/jobs/${id}?wait=25`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} is still ${job.status}. Check it again later.`);
    await sleep(1000);
  }
}

const [url, maxArg] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node auto-fallback.mjs TIKTOK_URL [MAX_CREDITS]");
  process.exit(2);
}
const maxCredits = Number.parseInt(maxArg ?? "6", 10);

// Free check before spending: is auto open to this key's plan for TikTok?
const capabilities = await api("GET", "/v1/capabilities");
if (!capabilities.tiktok.auto) {
  console.error("auto is not available on this plan. AI transcription needs a paid plan.");
  process.exit(1);
}

const idempotencyKey = randomUUID();
console.error(`Idempotency-Key: ${idempotencyKey}`);
const created = await api("POST", "/v1/jobs", {
  idempotencyKey,
  body: { source: { url }, mode: "auto", max_credits: maxCredits },
});
// While running, billing.credits_reserved holds the most this job may cost.
console.error(`Job ${created.id}: ${created.billing.credits_reserved} credit(s) held`);

const job = await waitForJob(created.id);
if (job.status !== "succeeded") {
  console.error(`Job ${job.status}: ${job.error?.code} ${job.error?.message ?? ""}`);
  process.exit(1);
}

const transcript = await api("GET", `/v1/transcripts/${job.result_id}`);
console.error(
  `Paid for ${job.billing.kind}: ${job.billing.credits_charged} credit(s). ` +
    `Origin ${transcript.source_origin}, timing ${transcript.timing_granularity}.`,
);

// AI transcription adds per word timing with confidence. Captions are timed per cue.
if (transcript.words) {
  for (const word of transcript.words.slice(0, 15)) {
    console.log(`${word.start.toFixed(2)}s ${word.text} (${Math.round(word.confidence * 100)}%)`);
  }
} else {
  console.log(transcript.text);
}
