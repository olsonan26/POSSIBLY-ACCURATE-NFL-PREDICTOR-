#!/usr/bin/env bash
# Run on a GPU worker with the pinned Xiaomi verl environment, never on Vercel.
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERL_DIR="$TASK_ROOT/training/vendor/verl"
VERL_COMMIT=a2ad9f6160b03ff2d47e59832bfb6b289f37c917
: "${MODEL_PATH:?Set MODEL_PATH to a downloadable/open-weight model you control, not an OpenRouter model ID}"
: "${DATA_DIR:?Set DATA_DIR to the output of prepare_dataset.py}"
if [[ ! -f "$VERL_DIR/examples/grpo_trainer/run_qwen3_4b_fsdp.sh" ]]; then
  echo 'Initialize the pinned dependency: git submodule update --init training/vendor/verl' >&2
  exit 1
fi
if [[ "$(git -C "$VERL_DIR" rev-parse HEAD)" != "$VERL_COMMIT" ]]; then
  echo 'Unexpected verl version. Review/pin changes before training.' >&2
  exit 1
fi
for name in train validation; do
  test -f "$DATA_DIR/$name.parquet" || { echo "Missing $name.parquet" >&2; exit 1; }
done
export PYTHONPATH="$VERL_DIR${PYTHONPATH:+:$PYTHONPATH}"
export MODEL_PATH
export TRAIN_FILE="$DATA_DIR/train.parquet"
export TEST_FILE="$DATA_DIR/validation.parquet"
export NGPUS_PER_NODE="${NGPUS_PER_NODE:-1}"
export ROLLOUT_TP="${ROLLOUT_TP:-1}"
export TRAIN_BATCH_SIZE="${TRAIN_BATCH_SIZE:-32}"
export PPO_MINI_BATCH_SIZE="${PPO_MINI_BATCH_SIZE:-16}"
export PPO_MICRO_BATCH_SIZE_PER_GPU="${PPO_MICRO_BATCH_SIZE_PER_GPU:-1}"
export ROLLOUT_N="${ROLLOUT_N:-4}"
export PROJECT_NAME=nfl_learning
export EXPERIMENT_NAME="${EXPERIMENT_NAME:-nfl-grpo-shadow-v1}"
export TOTAL_EPOCHS="${TOTAL_EPOCHS:-1}"
# test.parquet is intentionally never passed to the trainer.
bash "$VERL_DIR/examples/grpo_trainer/run_qwen3_4b_fsdp.sh" \
  "reward.custom_reward_function.path=$TASK_ROOT/training/nfl_reward.py" \
  reward.custom_reward_function.name=compute_score \
  'trainer.logger=[console]' \
  "trainer.default_local_dir=$TASK_ROOT/training/checkpoints/$EXPERIMENT_NAME" \
  "$@"
