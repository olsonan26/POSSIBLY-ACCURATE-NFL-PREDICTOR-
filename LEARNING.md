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

## Completed games and whole seasons

The DeepSeek button checks the exact matchup in the server-fetched schedule. Upcoming games use the pregame path. Completed games use EXP-033: archived recaps and box scores explain plausible contributors to the verified result, with source links, reported/inferred labels, uncertainty, repeatability, and questions for future pregame research. In-progress games wait for verified final scores. Ties can be reviewed without inventing a winner.

The learning journal loads any season from 1999 onward, with optional playoffs. It counts the actual completed games in the feed rather than assuming a season size. Loading the plan makes no paid calls. Starting the batch authorizes up to one research request per unsaved game. Requests run serially; pause takes effect after the current game. Keep the page open during processing. Reload the same season and press resume after closing the tab, a network failure, or an interrupted request. Durable reviews determine remaining work. There is no unattended paid season worker.

Reviews are cached by game/model/version and immutable. An atomic, three-minute database lease prevents simultaneous requests from paying to review the same game twice. Failed requests release their lease; an interrupted function's lease expires. A crash after a provider charge but before durable storage may require another paid request after expiry; exactly-once external billing is not guaranteed. Repeated successes do not add games or make paid calls.

Postgame research is descriptive evidence and testable hypotheses, not proof of what caused a win. Only bounded category/repeatability counts from up to 500 recently saved reviews enter future DeepSeek research prompts. Archived scores, narrative text, and stored instructions never enter those prompts. Current-game pre-kickoff sources still determine accepted facts. Each future frozen forecast records its memory cohort. A historical review saved today cannot affect a forecast captured yesterday, count as a successful pregame pick, train EXP-032 calibration, or enter the prospective verl export. Hosted DeepSeek weights are unchanged.

## Calibration rule

The only candidate parameter is a multiplier in `{0, 0.25, 0.5, 0.75, 1}` on the existing evidence logit adjustment:

`p_learning = sigmoid(logit(p_control) + scale × (logit(p_EXP031) − logit(p_control)))`

The training criterion is mean Brier score plus `0.002 × (scale − 1)^2`. This favors the original adjustment unless there is evidence to shrink it. The scale cannot reverse or amplify the adjustment.

There must be at least 40 prior distinct scored games before fitting a scale. Each subsequent forecast is checked using only outcomes recorded **before that forecast's capture**, including overlapping games and late-arriving labels. At least 40 such chronological checks must improve both Brier and log loss over the raw EXP-031 shadow by 0.001 before the fitted scale affects EXP-032. Until then it is 1.

These thresholds are conservative initial engineering defaults, not proof of a statistically significant NFL edge. EXP-032 remains a research shadow. Monitor the actual frozen learning-shadow results separately from simulated chronological checks. Do not promote it based on these thresholds alone, or describe a retrospective reconstruction as an unseen test. The existing failure-cluster research pipeline remains available through `bun run research:cycle`.

## Activate persistent feedback

1. Apply [`database/learning-schema.sql`](database/learning-schema.sql) and then [`database/postgame-schema.sql`](database/postgame-schema.sql) in the intended NFL database. RLS and explicit grants protect the independent learning tables. Existing ledger records are untouched.
2. Configure server environment variables in Vercel: `NFL_LEARNING_SUPABASE_URL`, `NFL_LEARNING_SUPABASE_KEY`, existing `OPENROUTER_API_KEY`, and optional `OPENROUTER_PREGAME_MODEL`. Never put private credentials in `VITE_` variables.
3. Storage supports a project service-role/secret key. The activated deployment instead uses a publishable API key **plus a dedicated private server secret** in `NFL_LEARNING_SECRET`, limiting access to these NFL tables. Apply [`database/learning-scoped-access.sql`](database/learning-scoped-access.sql) with its placeholder replaced by SHA-256 of that secret. The secret goes only in Vercel; its hash gates every database request through RLS. An ordinary publishable key alone cannot read or write learning records. These invoker RPCs inherit the same RLS boundary.
4. Configure `CRON_SECRET` and deploy. `/api/learning-status` must return healthy storage and research configuration. The Vercel production cron calls `/api/learning-sync` daily at 10:00 UTC, authorized by that secret, without model calls. Pregame research also syncs outcomes on demand.
5. For an optional independent GitHub worker, configure the learning storage secrets there too, including `NFL_LEARNING_SECRET` when using scoped access. Without them the workflow explicitly skips grading; production cron remains the primary idle-site worker. Use the matching `OPENROUTER_PREGAME_MODEL` repository variable for metrics.
6. Request an upcoming game's DeepSeek research. The UI must report a saved pre-kickoff forecast. Request a completed game's review and repeat it to confirm reuse. Load a season to verify its actual completed/remaining counts before starting paid bulk research.

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
bun run test:node-api
bun run research:pregame-intelligence
bun run test:ledger
bun run test:point-in-time
python3 -m unittest discover -s training -p 'test_*.py'
bun run typecheck
bun run build
```

The native Node check compiles the API and loads each server entry point, catching ESM resolution errors that Bun/Vite can hide. Server dependency imports explicitly use their emitted `.js` names. The learning API tests mock all network calls; they spend no model credits. `scripts/learning-schema.test.mjs` additionally checks the SQL with an isolated `@electric-sql/pglite` install; set `NFL_TEST_PGLITE_MODULE` to its absolute module path when it is installed outside this repo. A successful local schema test does not mean the intended production database has been configured.
