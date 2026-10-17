"""Check the built GeoJSON files. Exit code 1 (loud) on any problem.

Usage: python -I geo/check_geo.py counties.geojson zcta.geojson zcta_county.csv allowlist.txt
"""
import csv
import json
import os
import sys


def main(counties_path, zcta_path, lookup_path, allow_path):
    for p in (counties_path, zcta_path, lookup_path):
        if not os.path.isfile(p):
            sys.exit("ERROR: missing file " + p)
        if os.path.getsize(p) > 10 * 1024 * 1024:
            sys.exit("ERROR: file over 10 MB: " + p)

    counties = json.load(open(counties_path))["features"]
    if len(counties) != 62:
        sys.exit("ERROR: expected 62 counties, got %d" % len(counties))

    zctas = json.load(open(zcta_path))["features"]
    have = {f["properties"]["GEOID"] for f in zctas}
    want = {r["zcta"] for r in csv.DictReader(open(lookup_path, newline=""))}

    allowed = set()
    if os.path.isfile(allow_path):
        for line in open(allow_path):
            line = line.strip()
            if line and not line.startswith("#"):
                allowed.add(line.split()[0])

    missing = sorted(want - have - allowed)
    print("counties: %d | lookup ZCTAs: %d | matched: %d | allowed-missing: %d | missing: %d"
          % (len(counties), len(want), len(want & have), len((want - have) & allowed), len(missing)))
    if missing:
        sys.exit("ERROR: lookup ZCTAs with no shape: " + ", ".join(missing))


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
