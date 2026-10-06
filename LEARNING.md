# DeepSeek feedback and Xiaomi verl

The website uses `deepseek/deepseek-v4.1-flash` through OpenRouter. That connection performs inference. Adding a training library cannot update the provider's model weights. This change gives the application durable outcome feedback, and adds a separate, pinned GPU training path for an open-weight model you control.

## What happens when you run a game

1. The server verifies the matchup and kickoff against nflverse, and independently computes the existing v2.2 football control. Browser-supplied probabilities and scores cannot become learning labels.
2. Previously saved forecasts are checked against the server-fetched final-score feed. Each game supplies at most one learning example. Ties are stored but excluded from binary win scoring.
3. DeepSeek receives aggregate feedback about prior results and evidence categories. It collects current pregame sources and audits duplicates, uncertainty and conflicts within one paid request. It cannot choose a winner or override the existing evidence gate.
4. The existing EXP-031 news shadow remains available. A separate EXP-032 learning shadow may shrink its news adjustment after chronological checks. The production football pick is unchanged.
5. The first completed research request is saved before kickoff. Database clocks, an immutable record, model/version provenance and a payload hash prevent retroactive replacement. Reruns remain viewable but do not inflate the sample.
6. The next request, or the daily grading worker, attaches the verified outcome. Wins and losses both contribute to future feedback.

No DeepSeek call happens on page load or normal football prediction. The daily outcome worker makes no paid model calls. Completing a request after kickoff produces a visible, ineligible capture status instead of a fake prospective record. Database failures also remain visible.

More simulations or repeated requests do not create new NFL outcomes. More independent, correctly timestamped games improve the evidence available for learning; accuracy can still worsen and must be measured.

## Calibration rule

The only candidate parameter is a multiplier in `{0, 0.25, 0.5, 0.75, 1}` on the existing evidence logit adjustment:

`p_learning = sigmoid(logit(p_control) + scale × (logit(p_EXP031) − logit(p_control)))`

The training criterion is mean Brier score plus `0.002 × (scale − 1)^2`. This favors the original adjustment unless there is evidence to shrink it. The scale cannot reverse or amplify the adjustment.

There must be at least 40 prior distinct scored games before fitting a scale. Each subsequent forecast is checked using only outcomes recorded **before that forecast's capture**, including overlapping games and late-arriving labels. At least 40 such chronological checks must improve both Brier and log loss over the raw EXP-031 shadow by 0.001 before the fitted scale affects EXP-032. Until then it is 1.

These thresholds are conservative initial engineering defaults, not proof of a statistically significant NFL edge. EXP-032 remains a research shadow. Monitor the actual frozen learning-shadow results separately from simulated chronological checks. Do not promote it based on these thresholds alone, or describe a retrospective reconstruction as an unseen test. The existing failure-cluster research pipeline remains available through `bun run research:cycle`.

## Activate persistent feedback

1. In the intended Supabase project, run [`database/learning-schema.sql`](database/learning-schema.sql). It creates two independent append-only tables, enables RLS, and grants only server `service_role` SELECT/INSERT access. It does not alter the old prediction ledger.
2. Add server environment variables in Vercel:
   - `NFL_LEARNING_SUPABASE_URL`: that project's URL.
   - `NFL_LEARNING_SUPABASE_KEY`: that project's service-role/secret key. Never put this in a `VITE_` variable or client code.
3. Keep the existing `OPENROUTER_API_KEY` and optional `OPENROUTER_PREGAME_MODEL`. Deploy the change and run one upcoming game's DeepSeek analysis. The UI must say it was saved before kickoff. If it says not configured or failed, feedback is not active.
4. For grading even while the site is idle, add the two learning storage values as GitHub Actions secrets with the same names. The `Grade frozen DeepSeek forecasts` workflow runs daily at 10:00 UTC and can be dispatched manually. Without those secrets it reports a configuration failure rather than silently claiming to grade games. If you use another DeepSeek model, set the matching GitHub repository variable `OPENROUTER_PREGAME_MODEL`.

For a local worker, load server environment variables securely and run:

```bash
bun run learning:sync
bun run learning:export
```

The worker logs probabilities/metrics without credential values. Exports are stored under ignored `training/exports/`; they are not committed. Changing the provider model or experiment version starts a separate feedback cohort. First frozen forecasts remain associated with their original model.

## GPU training with Xiaomi verl

`training/vendor/verl` is a git submodule pinned to XiaomiMiMo/verl commit `a2ad9f6160b03ff2d47e59832bfb6b289f37c917`. It is not an npm dependency and is not imported into the website. Normal CI does not fetch it. Initialize it only on the training worker:

```bash
git submodule update --init training/vendor/verl
```

Use a GPU environment compatible with the pinned fork's installation guide. Its GPU example requires CUDA/PyTorch, FSDP and vLLM; hardware needs depend on the actual model. Do not assume one small GPU can train full-size DeepSeek V4.1. The launcher has no default `MODEL_PATH`, so it cannot silently rent hardware, choose a costly model, or train the hosted OpenRouter model.

Install the pinned fork in that environment, and the CPU conversion dependencies:

```bash
python3 -m pip install --no-deps -e training/vendor/verl
python3 -m pip install -r training/requirements-data.txt
python3 training/prepare_dataset.py \
  --input training/exports/frozen-forecasts.jsonl \
  --output training/datasets/experiment-001 \
  --validation-start YOUR_FROZEN_VALIDATION_START_UTC \
  --test-start YOUR_FROZEN_TEST_START_UTC
```

Select and freeze the split boundaries before examining performance. The converter rejects duplicate games, bad provenance and post-kickoff snapshots, embargoes late-arriving labels, and keeps test data separate. It requires at least 128 training, 32 validation and 32 test games as an experimental minimum, not a sufficient accuracy claim. At release, the new feedback tables have no historical DeepSeek training data. Old forecasts cannot be reconstructed as prospective evidence after the results are known.

Prompts contain the frozen control probability and anonymized numeric evidence. Real team names, game dates, source URLs, claim text and final scores are excluded from prompts to reduce historical-result memorization and stored-text injection. The final result is visible only to the reward hook. Anonymization reduces leakage risk; it cannot prove a pretrained model has never seen a matchup.

`training/nfl_reward.py` requires exactly `{"home_win_probability": number}` and awards `1 − (p − outcome)^2`. Invalid responses earn −1. This proper probability score discourages confidently wrong forecasts instead of rewarding confident language or self-approval.

```bash
MODEL_PATH=/path/to/your/open-weight-model \
DATA_DIR="$PWD/training/datasets/experiment-001" \
NGPUS_PER_NODE=1 \
bash training/train_grpo.sh
```

The launcher uses the pinned fork's GRPO/FSDP example with the NFL reward override. It monitors **validation.parquet**; it never passes **test.parquet** to training. Checkpoints stay under ignored `training/checkpoints/`. Full GPU execution was not tested in this change: no GPU worker, open-weight checkpoint or real training corpus was supplied.

Before serving a trained checkpoint, compare its probabilities to the control and raw DeepSeek shadow on the reserved test set, then freeze it for future shadow games. Record model/config hashes, identical forecast horizons, Brier, log loss, accuracy and calibration. A checkpoint is not automatically connected to the production website, and it does not replace or modify OpenRouter's DeepSeek weights.

## Verification

```bash
bun run test:learning
bun run research:pregame-intelligence
bun run test:ledger
bun run test:point-in-time
python3 -m unittest discover -s training -p 'test_*.py'
bun run typecheck
bun run build
```

The learning API tests mock all network calls; they spend no model credits. `scripts/learning-schema.test.mjs` additionally checks the SQL with an isolated `@electric-sql/pglite` install; set `NFL_TEST_PGLITE_MODULE` to its absolute module path when it is installed outside this repo. A successful local schema test does not mean the intended production database has been configured.
