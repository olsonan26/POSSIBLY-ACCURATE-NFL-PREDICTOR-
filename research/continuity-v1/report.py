"""Render audited baseline metrics without inventing a candidate evaluation."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"


def pct(value):
    return "n/a" if value is None else f"{value * 100:.2f}%"


def table(items):
    lines = ["| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for label, m in items:
        lines.append(f"| {label} | {m['games']} | {m['correct']} | {m['incorrect']} | {pct(m['accuracy'])} | {m.get('correct_incorrect', 'n/a')} | "
                     + (f"{m['brier']:.4f} | {m['log_loss']:.4f}" if m['games'] else "n/a | n/a")
                     + f" | {pct(m['home_pick_accuracy'])} | {pct(m['away_pick_accuracy'])} |")
    return "\n".join(lines)


def main():
    baseline = json.loads((OUT / "baseline.json").read_text())
    manifest = json.loads((OUT / "source-manifest.json").read_text())["sources"]
    gate = json.loads((OUT / "data-gate.json").read_text())
    text = ["# Phase 1 — offseason continuity audit v1", "",
        "**Decision: BLOCKED — insufficient point-in-time information. No continuity candidate was scored, selected, rejected on performance, or promoted. Phase 1 is not fully evaluated; later phases remain paused.**", "",
        "Production remains at `9fe9c75`, model `v2.2-validated-current-season`. The preregistration commit is `e70a731`.", "",
        "## Baseline reproduction", "",
        "Actual production code was called with a frozen nflverse games snapshot. All network requests except the frozen games feed were denied and audited. No live personnel data were requested. All historical results had zero personnel adjustment and no live personnel display.", "",
        table([(season, values['overall']) for season, values in baseline['seasons'].items()]), "",
        "2026 is observation only through September 14. 2020–2024 rows are retrospective baseline diagnostics, not untouched performance claims. The 2025 baseline matches 180/271 and Brier 0.2250. Displayed-probability log loss is 0.6416; the existing carryover research used unrounded probabilities and documented 0.6415. Do not mix rounding conventions when comparing candidates.", "",
        "## Source coverage and temporal eligibility", "",
        "| Season | Weekly roster teams | Depth-chart teams | Teams with timestamped preseason depth records | Eligible primary continuity profiles |",
        "|---|---:|---:|---:|---:|"]
    for year in range(2020,2026):
        roster, depth = manifest[f"rosters_{year}"], manifest[f"depth_{year}"]
        text.append(f"| {year} | {len(roster['week1_or_timestamped_team_rows'])} | {len(depth['week1_or_timestamped_team_rows'])} | {len(depth['timestamped_preseason_team_rows'])} | 0/32 |")
    text += ["", "All 19 requested source files downloaded successfully. Prior-season snap files cover 2019–2024. Raw coverage is not pregame eligibility. The 192 team-season records in `profile-coverage.json` are a coverage ledger with missing component values, not reconstructed continuity profiles.", "",
        "Older depth files expose season/week but no capture timestamp. All six weekly roster files lack a capture timestamp. The 2025 depth file does contain pre-season timestamped observations for all teams, but this does not establish full roster membership or historical 2020–2024 training coverage.", "",
        "The primary source implementation queries NGS by season and week, and includes a current-roster fallback with null weeks. This audit excludes non-REG/Week-1 rows, but found no documented guarantee that regular weekly rows were frozen before kickoff. That is an unresolved provenance issue, not proof that nflverse data are wrong or unusable.", "",
        "| Component | Audit disposition |", "|---|---|",
        "| Starting QB | Weekly historical depth available; pregame timing unverified for development/selection. Do not use realized game starter as announced starter. |",
        "| Offensive starters / offensive line / WR–TE–RB / defensive starters | Weekly depth available; same timing blocker. No starter overlap fabricated. |",
        "| Head coach / coordinators | Timestamped announcements not acquired. Game-record coach fields alone do not establish the pregame snapshot. |",
        "| Overall roster | Week 1 membership available for all teams, but pre-kickoff provenance unverified. |",
        "| Returning snap share | Prior-season snaps available; pregame membership and audited cross-source ID mapping still required. Not computed. |", "",
        "## Candidate evaluation", "",
        f"Games tested: {gate['candidate_games_tested']}. Correct, incorrect, accuracy, ratio, Brier, log loss, calibration, home/away accuracy, winner flips, rolling tests and ablations: **not computed**. Baseline fallback would not constitute a continuity experiment. No selection or confirmation candidate scores were examined.", "",
        "Required next input: timestamped opening-roster archives or independently documented historical pregame snapshot semantics for 2020–2025, followed by audited player-ID joins and snap coverage. The registered formula is unchanged. Do not replace unavailable continuity with a simple QB penalty or generic stronger carryover.", "",
        "## Baseline week splits and calibration", ""]
    for season, values in baseline['seasons'].items():
        text += [f"### {season}", "", table([(k, values[k]) for k in ['week_1','weeks_1_4','weeks_5_8','weeks_9_plus','overall']]), "",
                 f"Excluded ties: {', '.join(values['excluded_ties']) or 'none'}. Week 1 overlaps Weeks 1–4; these groups are not additive.", "",
                 "| Confidence band | Picks | Mean confidence | Observed accuracy |", "|---|---:|---:|---:|"]
        for band in values['overall']['calibration']:
            text.append(f"| {band['band']}% | {band['games']} | {pct(band['mean_confidence'])} | {pct(band['accuracy'])} |")
        text.append("")
    text += ["## Primary source references", "",
        "- [nflreadr weekly roster semantics](https://nflreadr.nflverse.com/reference/load_rosters_weekly.html)",
        "- [Depth-chart schema change and capture timestamps](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html)",
        "- [Prior-season snap data](https://nflreadr.nflverse.com/reference/load_snap_counts.html)",
        "- [NGS roster acquisition code, inspected commit](https://github.com/nflverse/nflverse-rosters/blob/ecc6ef182842deabc81b63018a220bb56d65d5f7/R/rosters_ngs.R)",
        "- [Depth snapshot accumulation code, inspected commit](https://github.com/nflverse/nflverse-rosters/blob/ecc6ef182842deabc81b63018a220bb56d65d5f7/exec/update-depth-charts.R)", ""]
    (ROOT / "REPORT.md").write_text("\n".join(text))


if __name__ == '__main__':
    main()
