"""Backfill missing or zero lat/lng on Hugo posts.

Walks content/posts/*.md, finds entries where lat/lng are absent or
both ~0, geocodes the address via Nominatim (with Photon fallback),
and rewrites the front matter in place.

Run from repo root. Used by .github/workflows/backfill-coords.yml.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

POSTS_DIR = "content/posts"
USER_AGENT = "VictorEats-Backfill/1.0 (victorchenclaude@gmail.com)"


def _http_get_json(url: str, headers: dict | None = None, timeout: int = 15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def nominatim(address: str) -> tuple[float, float] | None:
    q = urllib.parse.urlencode({"q": address, "format": "json", "limit": 1})
    try:
        results = _http_get_json(
            f"https://nominatim.openstreetmap.org/search?{q}",
            headers={"User-Agent": USER_AGENT},
        )
    except Exception as e:
        print(f"  nominatim error: {e}")
        return None
    if results:
        return float(results[0]["lat"]), float(results[0]["lon"])
    return None


def photon(address: str) -> tuple[float, float] | None:
    q = urllib.parse.urlencode({"q": address, "limit": 1})
    try:
        data = _http_get_json(f"https://photon.komoot.io/api/?{q}")
    except Exception as e:
        print(f"  photon error: {e}")
        return None
    feats = data.get("features") or []
    if feats:
        lng, lat = feats[0]["geometry"]["coordinates"]
        return float(lat), float(lng)
    return None


def geocode(address: str) -> tuple[float, float] | None:
    return nominatim(address) or photon(address)


def split_front_matter(text: str) -> tuple[str, str] | tuple[None, None]:
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n(.*)$", text, re.DOTALL)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def get_field(fm: str, key: str) -> str | None:
    m = re.search(rf"^{re.escape(key)}:\s*(.*?)\s*$", fm, re.MULTILINE)
    return m.group(1) if m else None


def needs_geocode(fm: str) -> bool:
    lat, lng = get_field(fm, "lat"), get_field(fm, "lng")
    if lat is None or lng is None:
        return True
    try:
        return abs(float(lat)) < 0.001 and abs(float(lng)) < 0.001
    except ValueError:
        return True


def upsert_field(fm: str, key: str, value) -> str:
    pattern = rf"^{re.escape(key)}:.*$"
    if re.search(pattern, fm, re.MULTILINE):
        return re.sub(pattern, f"{key}: {value}", fm, count=1, flags=re.MULTILINE)
    return fm.rstrip() + f"\n{key}: {value}"


def strip_quotes(s: str) -> str:
    s = s.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def main(dry_run: bool = False) -> int:
    if not os.path.isdir(POSTS_DIR):
        print(f"ERROR: {POSTS_DIR} not found (run from repo root)")
        return 1

    changed = 0
    failed = 0
    for filename in sorted(os.listdir(POSTS_DIR)):
        if not filename.endswith(".md"):
            continue
        path = os.path.join(POSTS_DIR, filename)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        fm, body = split_front_matter(text)
        if fm is None:
            continue
        if not needs_geocode(fm):
            continue
        address = get_field(fm, "address")
        if not address:
            print(f"{filename}: no address, skipping")
            continue
        address = strip_quotes(address)
        print(f"{filename}: geocoding {address!r}")
        coords = geocode(address)
        if not coords:
            print("  failed (both providers)")
            failed += 1
            time.sleep(1.1)
            continue
        lat, lng = coords
        new_fm = upsert_field(fm, "lat", lat)
        new_fm = upsert_field(new_fm, "lng", lng)
        new_text = f"---\n{new_fm}\n---\n{body}"
        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
        print(f"  -> ({lat}, {lng}){' [dry-run]' if dry_run else ''}")
        changed += 1
        time.sleep(1.1)

    print(f"\nUpdated {changed} post(s); {failed} failure(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(dry_run="--dry-run" in sys.argv))
