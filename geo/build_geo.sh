#!/usr/bin/env bash
# Build geo/ny_counties.geojson and geo/ny_zcta.geojson from Census 2020 cartographic boundary files.
# Run from the repo root:  bash geo/build_geo.sh
# Needs: curl, unzip, node/npx (mapshaper is fetched by npx), .venv/bin/python (or python3).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAPSHAPER="mapshaper@0.6.102"      # pinned version
BASE="https://www2.census.gov/geo/tiger/GENZ2020/shp"
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY="python3"

# Downloads go to a fresh temp folder, never into the repo.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/geo_build.XXXXXX")"
mkdir -p "$WORK/county" "$WORK/zcta"

for name in county:cb_2020_us_county_500k zcta:cb_2020_us_zcta520_500k; do
  dir="${name%%:*}"; file="${name##*:}"
  echo "Downloading $file.zip"
  curl -fL --retry 3 -o "$WORK/$file.zip" "$BASE/$file.zip"
  [ -s "$WORK/$file.zip" ] || { echo "ERROR: $file.zip is missing or empty" >&2; exit 1; }
  unzip -q -o "$WORK/$file.zip" -d "$WORK/$dir"
done

# Slim lookup (zcta, county_fips as text) for the join.
"$PY" -I -c '
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1], newline="")))
with open(sys.argv[2], "w", newline="") as f:
    w = csv.writer(f); w.writerow(["zcta", "county_fips"])
    for r in rows: w.writerow([r["zcta"], r["county_fips"]])
' "$ROOT/data/lookup/zcta_county.csv" "$WORK/lookup.csv"

# Counties: New York only (STATEFP 36), keep GEOID and NAME.
# -simplify 25% (visvalingam, keep shapes), -clean fixes overlaps/gaps, 5 decimal places.
npx -y "$MAPSHAPER" "$WORK/county/cb_2020_us_county_500k.shp" \
  -filter 'STATEFP == "36"' \
  -filter-fields GEOID,NAME \
  -simplify 25% keep-shapes \
  -clean \
  -o "$WORK/ny_counties.geojson" format=geojson precision=0.00001 force

# ZCTAs: keep those in the lookup (join on GEOID20), add county_fips, NAME = GEOID.
# ZCTAs have many tiny parts, so simplify harder (12%). allow-overlaps keeps ZCTAs that overlap a
# neighbor (plain -clean deleted ZCTA 14302, a tiny polygon inside ZCTA 14303's area).
npx -y "$MAPSHAPER" "$WORK/zcta/cb_2020_us_zcta520_500k.shp" \
  -rename-fields GEOID=GEOID20 \
  -join "$WORK/lookup.csv" keys=GEOID,zcta field-types=zcta:str,county_fips:str fields=county_fips \
  -filter 'county_fips != null && county_fips != ""' \
  -each 'NAME = GEOID' \
  -filter-fields GEOID,NAME,county_fips \
  -simplify 12% keep-shapes \
  -clean allow-overlaps \
  -o "$WORK/ny_zcta.geojson" format=geojson precision=0.00001 force

# Check before copying into the repo: fails loudly on a missing shape.
"$PY" -I "$ROOT/geo/check_geo.py" \
  "$WORK/ny_counties.geojson" "$WORK/ny_zcta.geojson" \
  "$ROOT/data/lookup/zcta_county.csv" "$ROOT/geo/missing_zcta_allowlist.txt"

cp "$WORK/ny_counties.geojson" "$ROOT/geo/ny_counties.geojson"
cp "$WORK/ny_zcta.geojson" "$ROOT/geo/ny_zcta.geojson"
ls -l "$ROOT/geo/ny_counties.geojson" "$ROOT/geo/ny_zcta.geojson"
echo "OK (temp files in $WORK)"
