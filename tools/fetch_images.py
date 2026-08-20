#!/usr/bin/env python3
"""Download every Ascended Heroes card image and transcode it to WebP.

Source images come from images.scrydex.com (733x1024 PNG).  We keep the native
resolution and re-encode to WebP so the whole set ships inside the app instead
of needing a network connection at runtime.
"""
import concurrent.futures as cf
import io
import json
import os
import sys
import time
import urllib.request

from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "assets/cards"
CARDS = json.load(open(sys.argv[2] if len(sys.argv) > 2 else "cards.json"))
QUALITY = 80

os.makedirs(OUT, exist_ok=True)


def grab(card):
    num = card["number"]
    dest = os.path.join(OUT, f"{num}.webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 4096:
        return num, "cached", os.path.getsize(dest)
    url = f"https://images.scrydex.com/pokemon/me2pt5-{num}/large"
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pokerevolutionpacks/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            im.save(dest, "WEBP", quality=QUALITY, method=6)
            return num, "ok", os.path.getsize(dest)
        except Exception as exc:  # noqa: BLE001 - retry any transport/decode error
            last = exc
            time.sleep(1.5 * (attempt + 1))
    return num, f"FAIL {last}", 0


done = failed = total = 0
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    for num, status, size in pool.map(grab, CARDS):
        done += 1
        total += size
        if status.startswith("FAIL"):
            failed += 1
            print(f"  !! {num}: {status}", flush=True)
        if done % 25 == 0:
            print(f"  {done}/{len(CARDS)} ... {total/1048576:.1f} MB", flush=True)
print(f"DONE {done} images, {failed} failed, {total/1048576:.1f} MB total")
