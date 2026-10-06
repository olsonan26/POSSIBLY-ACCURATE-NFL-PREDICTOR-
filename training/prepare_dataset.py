"""Convert immutable feedback exports to chronological verl datasets.

Labels, real team names, game dates, source text and postgame facts never enter
the prompt. Test data is held apart from the trainer's monitoring validation.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
VERSION = "EXP-032-feedback-v1"
CATEGORIES = {"qb", "injury", "offensive_line", "weather", "roster", "coaching"}


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError("Invalid numeric input")
    return value


def convert_record(row):
    o = row["outcome"]
    if row["experiment_version"] != VERSION or o["source"] != SOURCE or o["game_id"] != row["game_id"]:
        raise ValueError("Unverified record provenance")
    captured, kickoff, observed = (instant(row["captured_at"]), instant(row["kickoff_at"]), instant(o["observed_at"]))
    if not instant(row["completed_at"]) <= captured < kickoff < observed:
        raise ValueError("Record is not a frozen pre-kickoff forecast")
    home = number(o["home_score"], 0, 200)
    away = number(o["away_score"], 0, 200)
    if not float(home).is_integer() or not float(away).is_integer():
        raise ValueError("Scores must be integers")
    if home == away:
        return None
    base = number(row["base_home_probability"], 0.001, 0.999)
    facts = []
    for f in row["facts"]:
        if not f.get("accepted"):
            continue
        if f["category"] not in CATEGORIES or f["effect"] not in {"positive", "negative", "neutral"}:
            raise ValueError("Unknown evidence category/effect")
        role = "home" if f["team"] == row["home_team"] else "away" if f["team"] == row["away_team"] else "both" if f["team"] == "BOTH" else None
        if role is None:
            raise ValueError("Fact belongs to another game")
        # Numeric evidence survives anonymization; names and text cannot reveal
        # a historical winner or carry a stored instruction into training.
        facts.append({"category": f["category"], "team_role": role, "effect": f["effect"],
                      "severity": number(f["severity"], 0, 1), "confidence": number(f["confidence"], 0, 1),
                      "source_reliability": number(f["sourceReliability"], 0, 1),
                      "freshness": number(f["freshnessWeight"], 0, 1)})
    prompt = {"base_home_probability": base, "verified_pregame_evidence": facts}
    return {"data_source": "nfl_frozen_pregame_v1", "ability": "nfl_win_probability",
            "prompt": [{"role": "system", "content": 'Estimate NFL home win probability from a frozen football baseline and verified pregame evidence. Return only JSON: {"home_win_probability": <number from 0 to 1>}. Express uncertainty; do not invent evidence.'},
                       {"role": "user", "content": json.dumps(prompt, sort_keys=True)}],
            "reward_model": {"style": "rule", "ground_truth": str(int(home > away))},
            "extra_info": {"game_id": row["game_id"], "captured_at": row["captured_at"],
                           "kickoff_at": row["kickoff_at"], "outcome_observed_at": o["observed_at"]}}


def split_records(rows, validation_start, test_start):
    validation_boundary, test_boundary = instant(validation_start), instant(test_start)
    if validation_boundary >= test_boundary:
        raise ValueError("Validation start must precede test start")
    result = {"train": [], "validation": [], "test": []}
    seen = set()
    for row in rows:
        game_id = row["game_id"]
        if game_id in seen:
            raise ValueError("Duplicate game ID in export")
        seen.add(game_id)
        converted = convert_record(row)
        if converted is None:
            continue
        captured = instant(row["captured_at"])
        observed = instant(row["outcome"]["observed_at"])
        # Embargo late-arriving labels: training labels must have been available
        # at the start of validation. Validation labels before the test start.
        if captured < validation_boundary:
            if observed < validation_boundary:
                result["train"].append(converted)
        elif captured < test_boundary:
            if observed < test_boundary:
                result["validation"].append(converted)
        else:
            result["test"].append(converted)
    for records in result.values():
        records.sort(key=lambda r: (instant(r["extra_info"]["captured_at"]), r["extra_info"]["game_id"]))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--validation-start", required=True)
    parser.add_argument("--test-start", required=True)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    splits = split_records(rows, args.validation_start, args.test_start)
    minimum = {"train": 128, "validation": 32, "test": 32}
    for name, records in splits.items():
        if len(records) < minimum[name]:
            raise ValueError(f"{name} has {len(records)} games; requires at least {minimum[name]} for this experimental launcher")
    import pandas as pd
    args.output.mkdir(parents=True, exist_ok=True)
    for name, records in splits.items():
        pd.DataFrame(records).to_parquet(args.output / f"{name}.parquet", index=False)
    manifest = {"version": VERSION, "source_sha256": hashlib.sha256(raw).hexdigest(),
                "validation_start": args.validation_start, "test_start": args.test_start,
                "counts": {name: len(records) for name, records in splits.items()},
                "test_policy": "Do not use test.parquet for training, checkpoint selection or repeated tuning."}
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
