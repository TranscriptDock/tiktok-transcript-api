"""Try free captions first; on NO_CAPTIONS, fall back to AI transcription with a spend cap.

Cost: step 1 spends at most 1 credit (nothing if there are no captions).
      Step 2 runs only on NO_CAPTIONS: AI transcription at 2 credits per started minute,
      60 second minimum, capped by MAX_CREDITS (default 6, up to 3 minutes).
      Longer videos fail with BUDGET_EXCEEDED and nothing is charged. Paid plans only.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python auto_fallback.py TIKTOK_URL [MAX_CREDITS]
"""

import os
import sys
from uuid import uuid4

from transcriptdock import JobTimeoutError, TranscriptDock

if len(sys.argv) < 2:
    sys.exit("Usage: python auto_fallback.py TIKTOK_URL [MAX_CREDITS]")
url = sys.argv[1]
max_credits = int(sys.argv[2]) if len(sys.argv) > 2 else 6

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])


def run(body):
    """Submit one job with its own idempotency key and wait for it."""
    key = str(uuid4())  # save this with your record to replay safely
    print("Idempotency-Key:", key, file=sys.stderr)
    job = client.create_job(body, idempotency_key=key)
    try:
        return client.wait_for_job(job["id"], timeout=900, poll_interval=5)
    except JobTimeoutError as error:
        sys.exit(f"Still running: {error.job}")


# 1. Captions only. Never starts AI transcription.
job = run({"source": {"url": url}, "mode": "captions_only", "max_credits": 1})

if job["status"] == "failed" and job["error"]["code"] == "NO_CAPTIONS":
    print("No captions (nothing charged). Falling back to AI transcription, "
          f"capped at {max_credits} credits.", file=sys.stderr)
    if not client.capabilities()["tiktok"]["transcribe"]:
        sys.exit("AI transcription is not available on this plan. It needs a paid plan.")
    # 2. AI transcription with a cap. A new job, so a new idempotency key.
    job = run({"source": {"url": url}, "mode": "transcribe", "max_credits": max_credits})

if job["status"] != "succeeded":
    sys.exit(f"{job['status']}: {job.get('error')}")

billing = job["billing"]
print(f"Paid for {billing['kind']}: {billing['credits_charged']} credit(s)", file=sys.stderr)
transcript = client.get_transcript(job["result_id"])
print(transcript["text"])
