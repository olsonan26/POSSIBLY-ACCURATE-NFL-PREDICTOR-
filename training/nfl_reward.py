"""verl's custom reward hook: a strictly parsed, proper probability score."""
import json
import math


def compute_score(data_source, solution_str, ground_truth, extra_info=None):
    if data_source != "nfl_frozen_pregame_v1":
        return -1.0
    try:
        answer = solution_str.rsplit("</think>", 1)[-1].strip()
        if answer.startswith("```json") and answer.endswith("```"):
            answer = answer[7:-3].strip()
        prediction = json.loads(answer)
        if not isinstance(prediction, dict) or set(prediction) != {"home_win_probability"}:
            return -1.0
        p = prediction["home_win_probability"]
        if isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p <= 1:
            return -1.0
        y = int(ground_truth)
        if y not in (0, 1):
            return -1.0
        # A confident wrong pick earns less than an honest uncertain forecast.
        return 1.0 - (p - y) ** 2
    except (ValueError, TypeError, KeyError, AttributeError):
        return -1.0
