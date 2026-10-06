import copy
import json
import unittest
from nfl_reward import compute_score
from prepare_dataset import SOURCE, VERSION, convert_record, split_records


def fixture(game_id="g1", day="01"):
    return {"game_id": game_id, "experiment_version": VERSION,
            "completed_at": f"2025-01-{day}T11:00:00Z", "captured_at": f"2025-01-{day}T12:00:00Z",
            "kickoff_at": f"2025-01-{day}T18:00:00Z", "home_team": "KC", "away_team": "DEN",
            "base_home_probability": 0.6,
            "facts": [{"accepted": True, "category": "qb", "team": "KC", "effect": "negative",
                       "severity": 0.8, "confidence": 0.9, "sourceReliability": 1.0, "freshnessWeight": 1.0,
                       "summary": "POSTGAME TEXT MUST NOT ENTER PROMPTS", "sources": [{"url": "https://nfl.com/KC"}]}],
            "outcome": {"game_id": game_id, "observed_at": f"2025-01-{day}T23:00:00Z", "home_score": 28, "away_score": 17, "source": SOURCE}}


class TrainingTests(unittest.TestCase):
    def test_proper_reward_and_strict_parser(self):
        source = "nfl_frozen_pregame_v1"
        self.assertGreater(compute_score(source, '{"home_win_probability":0.9}', "1"), compute_score(source, '{"home_win_probability":0.6}', "1"))
        self.assertLess(compute_score(source, '{"home_win_probability":0.9}', "0"), compute_score(source, '{"home_win_probability":0.6}', "0"))
        for bad in ['bad', '{"home_win_probability":true}', '{"home_win_probability":NaN}', '{"home_win_probability":1.1}', '{"home_win_probability":"0.6"}', '{"home_win_probability":0.6,"extra":1}']:
            self.assertEqual(compute_score(source, bad, "1"), -1)
        self.assertEqual(compute_score("unknown", '{"home_win_probability":0.9}', "1"), -1)

    def test_anonymized_prompt(self):
        result = convert_record(fixture())
        prompt = json.dumps(result["prompt"])
        for prohibited in ("KC", "DEN", "2025", "POSTGAME", "home_score", "nfl.com"):
            self.assertNotIn(prohibited, prompt)
        self.assertEqual(result["reward_model"]["ground_truth"], "1")

    def test_temporal_split_and_embargo(self):
        rows = [fixture("a", "01"), fixture("b", "10"), fixture("c", "20")]
        split = split_records(rows, "2025-01-05T00:00:00Z", "2025-01-15T00:00:00Z")
        self.assertEqual([len(split[n]) for n in ("train", "validation", "test")], [1, 1, 1])
        rows[0]["outcome"]["observed_at"] = "2025-01-06T00:00:00Z"
        self.assertEqual(len(split_records(rows, "2025-01-05T00:00:00Z", "2025-01-15T00:00:00Z")["train"]), 0)
        with self.assertRaises(ValueError):
            split_records([fixture(), fixture()], "2025-01-05T00:00:00Z", "2025-01-15T00:00:00Z")

    def test_unverified_and_late_rows_are_rejected(self):
        base = fixture()
        for change in (lambda r: r.update(captured_at=r["kickoff_at"]), lambda r: r["outcome"].update(source="browser"), lambda r: r.update(experiment_version="unknown")):
            row = copy.deepcopy(base)
            change(row)
            with self.assertRaises(ValueError):
                convert_record(row)
        tied = fixture()
        tied["outcome"]["home_score"] = tied["outcome"]["away_score"]
        self.assertIsNone(convert_record(tied))


if __name__ == "__main__":
    unittest.main()
