// List a TikTok profile's latest videos, then fetch their captions in one batch.
//
// Cost: 1 credit for the profile listing, plus 1 credit per video that has captions.
//       Videos without captions fail for free (captions_only never starts AI transcription).
// Plan: items per batch are 1 on the free plan, 10 on Starter, 25 on Pro, 50 on Scale.
// Note: a profile listing returns at most 10 videos and has no next page. It fails with an
//       error when TikTok challenges the request.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node profile-to-batch.mjs @USER [COUNT]
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

async function pollUntil(path, isDone, { everyMs = 3000, timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const resource = await api("GET", path);
    if (isDone(resource)) return resource;
    if (Date.now() > deadline) throw new Error(`${path} is still ${resource.status}. Check it again later.`);
    await sleep(everyMs);
  }
}

const [user, countArg] = process.argv.slice(2);
if (!user) {
  console.error("Usage: node profile-to-batch.mjs @USER [COUNT]");
  process.exit(2);
}
const count = Math.min(Number.parseInt(countArg ?? "5", 10), 10);

// 1. The profile listing (1 credit). include_details true would also fetch each video page.
const queued = await api("POST", "/v1/video-discoveries", {
  idempotencyKey: randomUUID(),
  body: { kind: "tiktok_user_videos", user, limit: 10 },
});
const discovery = await pollUntil(`/v1/video-discoveries/${queued.id}`, (d) => d.status === "succeeded" || d.status === "failed");
if (discovery.status === "failed") {
  console.error(`Profile listing failed: ${discovery.error?.code} ${discovery.error?.message ?? ""}`);
  process.exit(1);
}

const profile = discovery.profile ?? {};
console.error(`${profile.unique_id ? `@${profile.unique_id}` : user}: ${profile.follower_count ?? "?"} followers, ${discovery.videos.length} video(s) listed`);
const videos = discovery.videos.slice(0, count);
if (videos.length === 0) process.exit(0);

// 2. One batch of caption jobs.
const batchKey = randomUUID(); // save it: resending the same body with it never creates a second batch
console.error(`Idempotency-Key: ${batchKey}`);
const created = await api("POST", "/v1/batches", {
  idempotencyKey: batchKey,
  body: {
    items: videos.map((video) => ({ source: { url: video.url }, mode: "captions_only", max_credits: 1 })),
    metadata: { profile: user },
  },
});

// 3. Wait for every item to be final. A batch.completed webhook avoids polling.
const finished = new Set(["succeeded", "partial_success", "failed", "cancelled"]);
const batch = await pollUntil(`/v1/batches/${created.id}`, (b) => finished.has(b.status), { everyMs: 5000, timeoutMs: 20 * 60_000 });
console.error(`Batch ${batch.status}: ${batch.succeeded_items} with captions, ${batch.failed_items} without`);

// 4. Print each transcript.
for (const item of batch.items) {
  const video = videos[item.item_index];
  const job = await api("GET", `/v1/jobs/${item.job_id}`);
  if (job.status !== "succeeded") {
    console.log(`\n# ${video.url}\n(${job.status}: ${job.error?.code ?? ""})`);
    continue;
  }
  const text = await api("GET", `/v1/transcripts/${job.result_id}/export?format=txt`, { text: true });
  console.log(`\n# ${video.url}\n${text}`);
}
