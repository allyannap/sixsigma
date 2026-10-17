# geo/: New York map shapes

| File | Features | Properties |
|---|---|---|
| `ny_counties.geojson` | 62 counties | `GEOID` (5-digit FIPS), `NAME` |
| `ny_zcta.geojson` | 1,826 ZIP code areas (ZCTAs) | `GEOID` (5 digits), `NAME` (= GEOID), `county_fips` (from `data/lookup/zcta_county.csv`) |

Both are WGS84 (longitude, latitude) GeoJSON. The API serves them at `/geo/ny_counties.geojson` and `/geo/ny_zcta.geojson`.

## Source
US Census Bureau 2020 cartographic boundary files (1:500,000), no key needed:
- https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip (counties; we keep STATEFP 36)
- https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip (ZCTAs; we keep those listed in `data/lookup/zcta_county.csv`)

Vintage: 2020. A ZCTA is the Census approximation of a ZIP code area, not an official USPS ZIP boundary.

## Rebuild
From the repo root (needs curl, unzip, node/npx and internet; downloads about 76 MB into a temp folder, not the repo):

    bash geo/build_geo.sh

Steps: download, keep New York, simplify with `mapshaper@0.6.102` (pinned in the script), write GeoJSON with 5-decimal coordinates, then `geo/check_geo.py` checks the result and the script exits non-zero if anything is wrong.

## Simplification settings
- Counties: `-simplify 25% keep-shapes`, then `-clean`. File size about 108 KB.
- ZCTAs: `-simplify 12% keep-shapes`, then `-clean allow-overlaps`. File size about 0.9 MB. Plain `-clean` deleted ZCTA 14302 (a tiny area that overlaps its neighbor), so overlaps are allowed.
- `keep-shapes` stops any area from collapsing to nothing.

## Checks and the allow-list
`geo/check_geo.py` fails (exit 1) when a file is missing or over 10 MB, the county count is not 62, or any ZCTA in the lookup has no shape, unless it is listed in `geo/missing_zcta_allowlist.txt` (one ZCTA per line, then the reason).

Lookup ZCTAs with no shape: **0** of 1,826. The allow-list is empty.
