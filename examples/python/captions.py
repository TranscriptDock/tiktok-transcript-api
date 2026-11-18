"""A TikTok video's creator captions, printed with timestamps and as SRT.

Cost: captions_only spends at most 1 credit, and nothing if the video has no captions.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python captions.py [TIKTOK_URL]
"""

import os
import sys
from uuid import uuid4

from transcriptdock import ApiError, JobTimeoutError, TranscriptDock

url = sys.argv[1] if len(sys.argv) > 1 else "https://www.tiktok.com/@tiktok/video/7680721699171601694"

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])

# Generate once per intended operation. Save this key and the returned job ID.
# Reuse the same key and exact body if a submission's response is lost.
submission_key = str(uuid4())
print("Idempotency-Key:", submission_key, file=sys.stderr)

try:
    job = client.create_job(
        {"source": {"url": url}, "mode": "captions_only", "max_credits": 1},
        idempotency_key=submission_key,
    )
    job = client.wait_for_job(job["id"], timeout=120)
except JobTimeoutError as error:
    sys.exit(f"Still running: {error.job}")
except ApiError as error:
    sys.exit(f"{error.code} {error.status} request {error.request_id}")

if job["status"] != "succeeded":
    code = (job.get("error") or {}).get("code")
    if code == "NO_CAPTIONS":
        sys.exit("No captions on this video (nothing charged). auto_fallback.py runs AI "
                 "transcription on paid plans.")
    sys.exit(f"{job['status']}: {job.get('error')}")

transcript = client.get_transcript(job["result_id"])
# Times come straight from the caption cues, in seconds. Never estimate them.
for segment in transcript["segments"]:
    print(f"[{segment['start']:.1f}s to {segment['end']:.1f}s] {segment['text']}")

print()
print(client.export_transcript(job["result_id"], "srt"))
