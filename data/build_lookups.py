"""Build the 2020 Census lookups for New York State.

Run from the repo root:   python data/build_lookups.py
Needs a free Census API key in the repo-root .env file, one line:  CENSUS_API_KEY=your_key
(.env is gitignored. This script never prints the key and never writes it anywhere.)

Writes:
  data/lookup/zcta_county.csv  zcta, county_fips, population, urban_rural (urban/suburban/rural/remote), land_sqmi
  data/lookup/counties.csv     county_fips, county_name, population

Method (also in data/README.md):
  1. Download 2020 population (P1_001N) for NY tracts, NY ZCTAs (or part) and NY counties.
  2. Download the Census ZCTA-to-tract relationship file (no key needed).
  3. Split each tract's population among the ZCTAs that overlap it, in proportion to the land
     area of the overlap (AREALAND_PART / tract land area).
  4. A ZCTA's county is the county holding the largest share of its apportioned population.
  5. Population written for a ZCTA is the Census value for the ZCTA (or part) in New York.
"""
import os
import sys
import tempfile
from pathlib import Path

import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
API = "https://api.census.gov/data/2020/dec/dhc"
REL_URL = ("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/"
           "tab20_zcta520_tract20_natl.txt")
SQM_PER_SQMI = 2_589_988.0
CACHE = Path(tempfile.gettempdir()) / "ems_census_cache"  # outside the repo


def read_key():
    """Return CENSUS_API_KEY from the environment, else from the repo-root .env (tiny parser)."""
    if os.environ.get("CENSUS_API_KEY", "").strip():
        return os.environ["CENSUS_API_KEY"].strip()
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("CENSUS_API_KEY"):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
                if key:
                    return key
    sys.exit("CENSUS_API_KEY not found. Put a line CENSUS_API_KEY=your_key in the repo-root .env "
             "(free key: https://api.census.gov/data/key_signup.html).")


def api_table(params, key):
    try:
        r = requests.get(API, params={**params, "key": key}, timeout=120)
    except requests.RequestException as e:
        sys.exit(f"Census API request failed ({type(e).__name__}); the URL is hidden because it holds the key.")
    if r.status_code != 200:
        # do not print the URL: it contains the key
        sys.exit(f"Census API error {r.status_code}: {r.text[:200]}")
    try:
        rows = r.json()
    except ValueError:
        body = r.text[:200].replace(key, "<KEY>")
        sys.exit(f"Census API did not return JSON (status {r.status_code}): {body!r}. "
                 "A bad or not-yet-activated key gives this; check the key and its activation email.")
    return pd.DataFrame(rows[1:], columns=rows[0])


def urban_rural(density):
    """Area type from density (people per square mile of land). Column name kept as urban_rural.

    urban >= 3000, suburban 500 to < 3000, rural 50 to < 500, remote < 50.
    """
    if density >= 3000:
        return "urban"
    if density >= 500:
        return "suburban"
    if density >= 50:
        return "rural"
    return "remote"


def main():
    key = read_key()
    CACHE.mkdir(exist_ok=True)

    tracts = api_table({"get": "P1_001N", "for": "tract:*", "in": ["state:36", "county:*"]}, key)
    tracts["tract_geoid"] = tracts["state"] + tracts["county"] + tracts["tract"]
    tracts["tract_pop"] = tracts["P1_001N"].astype(int)

    zc = api_table({"get": "P1_001N", "for": "zip code tabulation area (or part):*",
                    "in": "state:36"}, key)
    zc = zc.rename(columns={"zip code tabulation area (or part)": "zcta"})
    zc["population"] = zc["P1_001N"].astype(int)

    cn = api_table({"get": "NAME,P1_001N", "for": "county:*", "in": "state:36"}, key)
    counties = pd.DataFrame({
        "county_fips": "36" + cn["county"],
        "county_name": cn["NAME"].str.replace(" County, New York", "", regex=False),
        "population": cn["P1_001N"].astype(int),
    }).sort_values("county_fips")

    rel_path = CACHE / "tab20_zcta520_tract20_natl.txt"
    if not rel_path.exists():
        print("downloading relationship file (about 24 MB) ...")
        r = requests.get(REL_URL, timeout=300)
        r.raise_for_status()
        rel_path.write_bytes(r.content)
    rel = pd.read_csv(rel_path, sep="|", dtype=str, encoding="utf-8-sig")
    need = ["GEOID_ZCTA5_20", "GEOID_TRACT_20", "AREALAND_TRACT_20", "AREALAND_PART"]
    missing = [c for c in need if c not in rel.columns]
    if missing:
        sys.exit(f"relationship file header changed, missing columns: {missing}")
    rel = rel[rel["GEOID_TRACT_20"].str.startswith("36") & rel["GEOID_ZCTA5_20"].notna()].copy()
    rel["part"] = rel["AREALAND_PART"].astype(float)
    rel["tract_land"] = rel["AREALAND_TRACT_20"].astype(float)
    rel = rel[rel["GEOID_ZCTA5_20"].isin(set(zc["zcta"]))]
    rel = rel.merge(tracts[["tract_geoid", "tract_pop"]], left_on="GEOID_TRACT_20",
                    right_on="tract_geoid", how="left")
    rel["tract_pop"] = rel["tract_pop"].fillna(0)
    rel["apportioned"] = 0.0
    ok = rel["tract_land"] > 0
    rel.loc[ok, "apportioned"] = rel.loc[ok, "tract_pop"] * rel.loc[ok, "part"] / rel.loc[ok, "tract_land"]
    rel["county_fips"] = rel["GEOID_TRACT_20"].str[:5]

    # land area per ZCTA = sum of the NY parts
    land = rel.groupby("GEOID_ZCTA5_20")["part"].sum() / SQM_PER_SQMI
    # county per ZCTA: largest apportioned population, else largest land share
    by_cty = rel.groupby(["GEOID_ZCTA5_20", "county_fips"])[["apportioned", "part"]].sum().reset_index()
    by_cty = by_cty.sort_values(["GEOID_ZCTA5_20", "apportioned", "part", "county_fips"],
                                ascending=[True, False, False, True])
    best = by_cty.drop_duplicates("GEOID_ZCTA5_20").set_index("GEOID_ZCTA5_20")["county_fips"]

    out = zc[["zcta", "population"]].copy()
    out["county_fips"] = out["zcta"].map(best)
    out["land_sqmi"] = out["zcta"].map(land)
    dropped = out[out["county_fips"].isna() | out["land_sqmi"].isna()]
    if len(dropped):
        print(f"note: dropping {len(dropped)} ZCTAs with no tract overlap in the relationship file")
    out = out.dropna(subset=["county_fips", "land_sqmi"])
    out["density"] = out["population"] / out["land_sqmi"].where(out["land_sqmi"] > 0)
    out["urban_rural"] = out["density"].apply(lambda d: "remote" if pd.isna(d) else urban_rural(d))
    out["land_sqmi"] = out["land_sqmi"].round(3)
    out = out[["zcta", "county_fips", "population", "urban_rural", "land_sqmi"]].sort_values("zcta")

    assert len(counties) == 62, f"expected 62 NY counties, got {len(counties)}"
    assert 1700 <= len(out) <= 1900, f"expected about 1,790 ZCTAs, got {len(out)}"
    assert set(out["county_fips"]) <= set(counties["county_fips"]), "unknown county FIPS"

    (HERE / "lookup").mkdir(exist_ok=True)
    out.to_csv(HERE / "lookup" / "zcta_county.csv", index=False)
    counties.to_csv(HERE / "lookup" / "counties.csv", index=False)
    print(f"wrote {len(out)} ZCTAs and {len(counties)} counties to data/lookup/")
    print(out["urban_rural"].value_counts().to_string())


if __name__ == "__main__":
    main()
