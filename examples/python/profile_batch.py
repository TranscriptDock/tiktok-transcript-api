"""List a TikTok profile's latest videos, fetch their captions in one batch, print each.

Cost: 1 credit for the profile listing, plus 1 credit per video that has captions.
      Videos without captions fail for free (captions_only never starts AI transcription).
Plan: items per batch are 1 on the free plan, 10 on Starter, 25 on Pro, 50 on Scale.
Note: a profile listing returns at most 10 videos and has no next page. It fails with
      an error when TikTok challenges the request.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python profile_batch.py @USER [COUNT]
"""

import os
import sys
import time
from uuid import uuid4

from transcriptdock import TranscriptDock

if len(sys.argv) < 2:
    sys.exit("Usage: python profile_batch.py @USER [COUNT]")
user = sys.argv[1]
count = min(int(sys.argv[2]) if len(sys.argv) > 2 else 5, 10)

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])


def poll(read, resource_id, done, every=3, timeout=600):
    """Call read(resource_id) every few seconds until done(resource) is true."""
    deadline = time.monotonic() + timeout
    while True:
        resource = read(resource_id)
        if done(resource):
            return resource
        if time.monotonic() > deadline:
            sys.exit(f"{resource_id} is still {resource['status']}. Check it again later.")
        time.sleep(every)


# 1. The profile listing (1 credit).
queued = client.create_video_discovery(
    {"kind": "tiktok_user_videos", "user": user, "limit": 10},
    idempotency_key=str(uuid4()),
)
discovery = poll(client.get_video_discovery, queued["id"],
                 lambda d: d["status"] in ("succeeded", "failed"))
if discovery["status"] == "failed":
    sys.exit(f"Profile listing failed: {discovery.get('error')}")

profile = discovery.get("profile") or {}
handle = f"@{profile['unique_id']}" if profile.get("unique_id") else user
print(f"{handle}: {profile.get('follower_count')} followers, "
      f"{len(discovery['videos'])} video(s) listed", file=sys.stderr)
videos = discovery["videos"][:count]
if not videos:
    sys.exit(0)

# 2. One batch of caption jobs. Save the key: resending the same body with it
#    returns the original batch instead of creating a second one.
batch_key = str(uuid4())
print("Idempotency-Key:", batch_key, file=sys.stderr)
batch = client.create_batch(
    {"items": [{"source": {"url": v["url"]}, "mode": "captions_only", "max_credits": 1}
               for v in videos],
     "metadata": {"profile": user}},
    idempotency_key=batch_key,
)

# 3. Wait for every item to be final.
batch = poll(client.get_batch, batch["id"],
             lambda b: b["status"] in ("succeeded", "partial_success", "failed", "cancelled"),
             every=5, timeout=1200)
print(f"Batch {batch['status']}: {batch['succeeded_items']} with captions, "
      f"{batch['failed_items']} without", file=sys.stderr)

# 4. Print each transcript.
for item in batch["items"]:
    video = videos[item["item_index"]]
    job = client.get_job(item["job_id"])
    print(f"\n# {video['url']}")
    if job["status"] != "succeeded":
        print(f"({job['status']}: {(job.get('error') or {}).get('code')})")
        continue
    print(client.export_transcript(job["result_id"], "txt"))
