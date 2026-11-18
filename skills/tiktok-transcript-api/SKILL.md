---
name: tiktok-transcript-api
description: Get TikTok transcripts, captions and subtitles with the Transcript Dock HTTP API, with AI transcription as a paid fallback, and list a TikTok profile's latest videos. Use when the user shares a TikTok link (tiktok.com or vm.tiktok.com), asks what a TikTok says, wants SRT or VTT subtitles for it, or wants the transcripts of a creator's recent videos. Spends the user's credits, so follow the cost rules.
---

# TikTok transcripts with Transcript Dock

Every transcript is an asynchronous job: submit, wait, then read or export. Full reference: https://www.transcriptdock.com/docs/api-reference

## When to use

- A TikTok link (`tiktok.com/@user/video/...` or a `vm.tiktok.com/...` share link) and a request for its transcript, captions, subtitles, quotes or a summary.
- "Transcribe the latest videos from @someone."

Not for private videos (they fail), TikTok search (not available), translation (not offered) or speaker labels (not offered).

## Setup

- Base URL `https://www.transcriptdock.com`. Always `www`: the apex redirects and drops the `Authorization` header.
- Header `Authorization: Bearer $TRANSCRIPTDOCK_API_KEY` from the environment. Never print the key, put it in a URL or ask for it in chat. If it is missing, tell the user to create one at https://www.transcriptdock.com/dashboard.
- POST bodies are JSON with `Content-Type: application/json`.

## Step 1. Check the plan (free)

`GET /v1/capabilities` with the key shows `tiktok.captions_only`, `tiktok.auto` and `tiktok.transcribe` for this plan. `GET /v1/usage` shows `plan` and `credits_remaining`. The free plan has captions only.

## Step 2. Submit captions first

```bash
KEY_ID="$(uuidgen 2>/dev/null || date +%s%N)"   # generate ONCE per intended job and remember it
curl -sS -X POST https://www.transcriptdock.com/v1/jobs \
  -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" \
  -H "Idempotency-Key: $KEY_ID" \
  -H "Content-Type: application/json" \
  -d '{"source":{"url":"TIKTOK_URL"},"mode":"captions_only","max_credits":1}'
```

- `captions_only` reads the creator's subtitle track: 1 credit on success, 0 when there are none. Always start here.
- `caption_languages` (up to 5 codes in order) picks among the tracks a video has.
- `Idempotency-Key` is required. If a response is lost, resend the SAME body with the SAME key. Never retry with a new key.
- Always send `max_credits`. It is ignored for `captions_only` and protects you if the mode changes.

## Step 3. Wait (free)

`GET /v1/jobs/{id}?wait=25` holds up to 25 seconds and returns when the job is final. Repeat until `status` is `succeeded`, `failed` or `cancelled`. Stop after about 10 minutes and give the user the job id. Reads are limited to 120 a minute.

## Step 4. Read or export (free)

- `GET /v1/transcripts/{result_id}`: `text`, `segments` (`start`, `end` in seconds, `text`), `words` (AI only), `timing_granularity`, `source_origin`, `language`.
- `GET /v1/transcripts/{result_id}/export?format=txt|json|srt|vtt`.

## When there are no captions

Many TikToks have no subtitles. If the job fails with `NO_CAPTIONS`, nothing was charged. STOP and ask the user before AI transcription:

- It costs 2 credits per started minute, minimum 2 credits. Most TikToks under a minute cost 2 credits; a 3 minute one costs 6.
- It needs a paid plan.

Only on a clear yes, submit a NEW job with `"mode":"transcribe"` (or `"auto"`), a NEW idempotency key and `max_credits` set to the estimate. `BUDGET_EXCEEDED` means the video was longer than the cap and nothing was charged: ask before raising it.

If the user has already agreed to AI cost for a set of videos, `"mode":"auto"` with a per item `max_credits` does captions where they exist and AI elsewhere in one step.

## A profile's latest videos (1 credit)

```bash
curl -sS -X POST https://www.transcriptdock.com/v1/video-discoveries \
  -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" -H "Idempotency-Key: $KEY_ID" \
  -H "Content-Type: application/json" \
  -d '{"kind":"tiktok_user_videos","user":"@handle","limit":10}'
```

Then `GET /v1/video-discoveries/{id}` every few seconds until `status` is `succeeded` or `failed`.

- At most 10 videos, no next page, no cursor.
- `profile` has `unique_id`, `nickname`, `follower_count`, `video_count` and more when TikTok shows them. Each video has `url` and a `tiktok` object.
- `"include_details": true` also fetches each video page (likes, comments, hashtags, music, caption languages). A page that fails sets `tiktok.details_error` on that row.
- If TikTok challenges the request, the discovery fails. Say so. Do not invent a video list.

Show the user the list and the total cost before transcribing. Submit several with `POST /v1/batches` (`items` are job bodies; 1 item on the free plan, 10 Starter, 25 Pro, 50 Scale), then `GET /v1/batches/{id}` until `status` is `succeeded`, `partial_success`, `failed` or `cancelled`.

## Errors

| Code | What to do |
|---|---|
| `NO_CAPTIONS` | Ask before AI transcription (above). |
| `PLAN_REQUIRED` | AI transcription and larger batches need a paid plan. |
| `INSUFFICIENT_BALANCE` | Out of credits. Do not retry. |
| `BUDGET_EXCEEDED` | Over `max_credits`, nothing charged. Ask before raising. |
| `SOURCE_PRIVATE`, `SOURCE_NOT_FOUND`, `SOURCE_AUTH_REQUIRED`, `SOURCE_REGION_RESTRICTED` | Not publicly reachable. Tell the user. Never try to bypass. |
| `SOURCE_RATE_LIMITED`, `SOURCE_BLOCKED`, `SOURCE_TIMEOUT` | TikTok is throttling. The job retries by itself; keep waiting. |
| `RATE_LIMITED` | Wait `retry_after_seconds`, then resend with the same idempotency key. |
| `retryable: true` | Back off and resend with the same key, a few times at most. |
| `retryable: false` | Do not retry unchanged. Explain and quote `request_id`. |

## Never invent timestamps

- Quote times only from `segments[].start` and `end` (or `words[]`) of the transcript you fetched. They are seconds.
- Caption timing is per cue. Word timing exists only after AI transcription (`timing_granularity: "word"`).
- If `timing_granularity` is `none`, say there is no timing.
- Quote text exactly. If something is not in the transcript, say so instead of guessing. A video's on screen text and its description are not part of the transcript.
