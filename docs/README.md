# TikTok API reference (compact)

The TikTok parts of the Transcript Dock `/v1` API on one page. Full reference: [transcriptdock.com/docs/api-reference](https://www.transcriptdock.com/docs/api-reference). Contract: [OpenAPI 3.1](https://www.transcriptdock.com/docs/openapi.yaml). Every source and endpoint: [transcriptdock-api](https://github.com/TranscriptDock/transcriptdock-api).

## Basics

- Base URL `https://www.transcriptdock.com` (always `www`).
- `Authorization: Bearer td_live_...` from the [dashboard](https://www.transcriptdock.com/dashboard).
- `Idempotency-Key` (8 to 128 printable ASCII characters) is required on every POST below. Same key and body replays the original at no cost. A different body is `409 IDEMPOTENCY_CONFLICT`.
- Every response has `X-Request-Id`.

## Accepted links

`tiktok.com/@user/video/...` and `vm.tiktok.com/...` share links. Public videos only. Up to 2 hours.

## Create a job: `POST /v1/jobs`

| Field | Notes |
|---|---|
| `source.url` | The TikTok link |
| `mode` | `captions_only` (creator subtitles, 1 credit, never AI), `auto` (captions else AI), `transcribe` (AI). AI needs a paid plan. |
| `caption_languages` | Up to 5 codes in order of preference. Empty means the default track. |
| `language` | Spoken language hint for AI transcription only |
| `max_credits` | AI spend cap. 2 credits per started minute, 60 second minimum. Ignored for `captions_only`. |
| `webhook_endpoint_id` | Receives `job.succeeded` or `job.failed` |
| `metadata` | Up to 10 string values, echoed in webhooks |

Returns `202` (queued) or `200` (already in your workspace, `billing.kind: "cached"`, free).

## Wait: `GET /v1/jobs/{id}?wait=25`

Holds up to 25 seconds and returns when `status` is `succeeded`, `failed` or `cancelled`. `result_id` is the transcript id. `billing.kind` is `captions`, `ai_transcription` or `cached`.

## Transcript: `GET /v1/transcripts/{id}`

`text`, `segments` (`start`, `end` seconds, `text`), `words` (AI only, with `confidence`), `timing_granularity` (`segment` for captions, `word` for AI), `source_origin`, `language`, `duration_seconds`, `recognition`, `created_at`.

Export: `GET /v1/transcripts/{id}/export?format=txt|json|srt|vtt`. Free and repeatable.

## Profile videos: `POST /v1/video-discoveries`

```json
{ "kind": "tiktok_user_videos", "user": "@handle", "limit": 10, "include_details": false }
```

- `user`: `@handle` or profile URL. `limit` up to 10.
- 1 credit. No `cursor`, no next page. Results are kept 24 hours.
- Read `GET /v1/video-discoveries/{id}` until `status` is `succeeded` or `failed`.
- `profile`: `id`, `unique_id`, `nickname`, `signature`, `verified`, `private_account`, `avatar_url`, `follower_count`, `following_count`, `heart_count`, `video_count`, `region`, `language`, `created_at` (null when TikTok does not show them).
- Each video: `url`, `video_id`, `title`, `duration_s`, `view_count`, `thumbnail_url` and a `tiktok` object (`description`, `created_at`, `play_count`, `like_count`, `comment_count`, `share_count`, `collect_count`, `hashtags`, `mentions`, `music`, `author`, `subtitle_languages` and more). It never carries signed play or download URLs.
- `include_details: true` fetches each video page for the full detail object. A page that fails keeps its row with `tiktok.details_error` set.
- When TikTok challenges the request or embeds no list, the discovery fails with an error.

TikTok search is not available.

## Batches: `POST /v1/batches`

`items`: an array of job bodies. Items per batch: 1 free, 10 Starter, 25 Pro, 50 Scale. Accepted or rejected as a whole. `GET /v1/batches/{id}` returns `status` (`queued`, `processing`, `succeeded`, `partial_success`, `failed`, `cancelled`), counters and `items` with each `job_id`.

## Errors you will meet on TikTok

| Code | HTTP | Meaning |
|---|---|---|
| `NO_CAPTIONS` | 422 | No subtitles and the mode was `captions_only`. Free. |
| `SOURCE_PRIVATE` / `SOURCE_NOT_FOUND` / `SOURCE_AUTH_REQUIRED` / `SOURCE_REGION_RESTRICTED` | 422 | The video is not publicly reachable. |
| `SOURCE_RATE_LIMITED` / `SOURCE_BLOCKED` / `SOURCE_TIMEOUT` | 503 | TikTok is throttling. The job retries automatically. |
| `PLAN_REQUIRED` | 402 | AI transcription or a larger batch on the free plan. |
| `BUDGET_EXCEEDED` | 402 | Measured cost above `max_credits`. Nothing charged. |
| `RATE_LIMITED` | 429 | Wait `Retry-After`. |

Every code: [error list](https://www.transcriptdock.com/docs/api-reference#error-codes).
