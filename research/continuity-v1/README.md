# Offseason continuity research v1

Read [REPORT.md](REPORT.md) for the result and [METHODOLOGY.md](METHODOLOGY.md)
for the committed preregistration. **Phase 1 is blocked, not completed or rejected.**

This directory contains a source-provenance audit and production baseline harness.
It does not contain a validated continuity scorer. No production file imports it.
No feature selection, coefficient fitting, candidate confirmation, ablation, or
production deployment has occurred. Later phases must wait for the Phase 1 gate.

## Reproduce

From the repository root, with Node 24, Python 3 and project dependencies installed:

```sh
npm install --ignore-scripts --no-package-lock
node --loader ./research/continuity-v1/ts-loader.mjs research/continuity-v1/baseline.mjs --all-seasons
node --loader ./research/continuity-v1/ts-loader.mjs research/continuity-v1/check-leakage.mjs
python research/continuity-v1/report.py
```

The baseline runs entirely offline against the committed compressed game snapshot;
its uncompressed SHA-256 is checked against `results/source-manifest.json`.
The loader only transpiles the existing TypeScript modules; it does not patch their
logic or synthesize football data. Source game ties update production Elo but are
excluded from winner accuracy, matching the existing benchmark.

To reproduce roster/depth/snap availability inspection (requires network):

```sh
python research/continuity-v1/audit_sources.py
```

The acquisition script verifies cached bytes and compares downloads to committed
source hashes. Mutable upstream release files are not immutable URLs: if they
change, the audit stops and retains existing results. Recover the recorded bytes
or explicitly version a new acquisition; do not silently overwrite the benchmark.
Large roster/depth/snap downloads are cached locally and not added to the repository.
The compressed games input is attributed to nflverse/nfldata; it is research-only.

`data-gate.json` records the outcome of this specific provenance audit, not a generic
automated validator that can approve arbitrary replacement data. Additional archival
evidence needs explicit review and versioning. `profile-coverage.json` contains all
32 franchises × 6 seasons; nulls mean not computed, never zero continuity.

## Verification performed

- TypeScript typecheck and Vite production build passed.
- Exact production 2025 benchmark and locked 2026 observation reproduced.
- Baseline metrics cover 1,626 non-tied games across 2020–2026 (2026 cutoff applied).
- Every run denies and logs non-games network requests, and checks retrospective
  personnel fields and adjustments remain absent/zero.
- Adversarial tests corrupt target-day and all later scores in separate processes
  for opening-day, neutral-site, and late-season fixtures. Production probabilities
  and picks stay identical. See `results/leakage-check.json`.
- All changed paths are under `research/continuity-v1/`.

Full per-game predictions, calibration and week splits are in `results/`.
Candidate winner flips and performance are unavailable because the candidate
has not passed the data gate; they are not reported as an empty successful test.
