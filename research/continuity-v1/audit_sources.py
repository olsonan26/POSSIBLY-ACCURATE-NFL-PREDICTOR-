"""Acquire immutable local inputs and audit pregame continuity coverage (stdlib only).

No outcomes are inspected here. Weekly labels do not substitute for timestamps.
Run from any directory: python research/continuity-v1/audit_sources.py
"""
import csv
import gzip
import hashlib
import io
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
OUT = ROOT / "results"
TEAMS = "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LA LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split()
ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA", "JAC": "JAX", "WSH": "WAS"}
COMPONENTS = ["starting_qb", "offensive_starters", "offensive_line", "wr_te_rb", "defensive_starters", "head_coach", "coordinators", "overall_roster", "returning_snap_share"]


def normalize(team):
    return ALIASES.get(team, team)


def acquire(item):
    name, url = item
    path = CACHE / (name + ".csv.gz")
    meta_path = CACHE / (name + ".json")
    if path.exists() and meta_path.exists():
        raw = gzip.decompress(path.read_bytes())
        meta = json.loads(meta_path.read_text())
        if hashlib.sha256(raw).hexdigest() != meta["sha256"]:
            raise ValueError(f"Cached input changed: {name}")
    else:
        with urlopen(url, timeout=120) as response:
            raw = response.read()
        meta = {"name": name, "url": url, "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        path.write_bytes(gzip.compress(raw, mtime=0))
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    headers = reader.fieldnames
    rows = list(reader)
    if not rows or not headers:
        raise ValueError(f"Empty source: {name}")
    meta = {**meta, "rows": len(rows), "columns": headers}
    if name == "games":
        # The production runner consumes this exact frozen file via an offline fetch shim.
        (CACHE / "games.csv").write_bytes(raw)
        return name, meta, rows
    teams = Counter()
    pregame_teams = Counter()
    missing_ids = 0
    season = int(name.rsplit("_", 1)[1])
    if "dt" in headers:
        # 2025 schema. Use a fixed date before the first NFL regular-season day;
        # timing availability only, never derive candidate values in this audit.
        cutoff = "2025-09-04T00:00:00Z"
        for r in rows:
            team = normalize(r.get("team", ""))
            teams[team] += 1
            if season == 2025 and r.get("dt", "") and r["dt"] < cutoff:
                pregame_teams[team] += 1
            missing_ids += not bool(r.get("gsis_id"))
        meta["earliest_capture"] = min(r["dt"] for r in rows if r.get("dt"))
        meta["latest_capture"] = max(r["dt"] for r in rows if r.get("dt"))
    else:
        for r in rows:
            if r.get("game_type") == "REG" and r.get("week") == "1":
                teams[normalize(r.get("team", r.get("club_code", "")))] += 1
                missing_ids += not bool(r.get("pfr_player_id") if name.startswith("snaps_") else r.get("gsis_id"))
    meta["week1_or_timestamped_team_rows"] = dict(sorted(teams.items()))
    meta["timestamped_preseason_team_rows"] = dict(sorted(pregame_teams.items()))
    meta["missing_primary_ids_in_audited_rows"] = missing_ids
    meta["has_capture_timestamp"] = "dt" in headers
    meta["source_role"] = "prior-season realized snaps only" if name.startswith("snaps_") else "roster/depth snapshot"
    return name, meta, None


def main():
    CACHE.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    manifest_path = OUT / "source-manifest.json"
    pinned = json.loads(manifest_path.read_text()).get("sources", {}) if manifest_path.exists() else {}
    sources = [("games", "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")]
    base = "https://github.com/nflverse/nflverse-data/releases/download"
    for year in range(2020, 2026):
        sources += [(f"rosters_{year}", f"{base}/weekly_rosters/roster_weekly_{year}.csv"),
                    (f"depth_{year}", f"{base}/depth_charts/depth_charts_{year}.csv"),
                    (f"snaps_{year-1}", f"{base}/snap_counts/snap_counts_{year-1}.csv")]
    metadata = {}
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {name: pool.submit(acquire, (name, url)) for name, url in sources}
        for name, future in futures.items():
            try:
                _, meta, _ = future.result()
                if name in pinned and meta["sha256"] != pinned[name]["sha256"]:
                    raise ValueError("Source differs from the committed snapshot; retain old results and explicitly version a new acquisition")
                metadata[name] = meta
                print(f"{name}: {meta['rows']} rows; sha256 {meta['sha256'][:12]}", flush=True)
            except Exception as error:
                errors.append({"source": name, "error": str(error)})
                print(f"{name}: FAILED {error}", flush=True)
    if errors:
        (OUT / "acquisition-errors.json").write_text(json.dumps(errors, indent=2) + "\n")
        raise SystemExit("Source acquisition incomplete or changed; existing results preserved")
    manifest_path.write_text(json.dumps({"sources": metadata, "errors": errors}, indent=2) + "\n")
    profiles = []
    for season in range(2020, 2026):
        roster = metadata.get(f"rosters_{season}", {})
        depth = metadata.get(f"depth_{season}", {})
        for team in TEAMS:
            profiles.append({"season": season, "team": team, "eligible": False,
                "weekly_roster_rows": roster.get("week1_or_timestamped_team_rows", {}).get(team, 0),
                "weekly_or_timestamped_depth_rows": depth.get("week1_or_timestamped_team_rows", {}).get(team, 0),
                "pregame_timestamped_depth_rows": depth.get("timestamped_preseason_team_rows", {}).get(team, 0),
                "components": {key: {"value": None, "status": "insufficient information",
                    "reason": "No timestamped coaching announcements acquired" if key in ("head_coach", "coordinators")
                    else "Not computed: historical pregame training coverage is blocked. Timestamped 2025 depth rows, where present, do not establish older snapshots or full roster membership."}
                    for key in COMPONENTS}})
    (OUT / "profile-coverage.json").write_text("[\n" + ",\n".join(json.dumps(p) for p in profiles) + "\n]\n")
    gate = {"status": "BLOCKED", "hypothesis_rejected": False, "candidate_evaluated": False,
            "candidate_games_tested": 0, "production_changes": False,
            "eligible_team_seasons": 0, "required_team_seasons_per_year": 30,
            "reason": "Weekly roster files lack capture timestamps; no verified pregame snapshot convention acquired. Cannot reconstruct primary returning-snap-share profiles without assuming pregame membership.",
            "next_phase_allowed": False,
            "remediation": "Acquire timestamped opening rosters or independently establish historical pregame snapshot semantics for 2020–2025; join prior-season snap IDs and audit coverage before selecting any coefficient."}
    (OUT / "data-gate.json").write_text(json.dumps(gate, indent=2) + "\n")
    print(json.dumps(gate, indent=2))


if __name__ == "__main__":
    main()
