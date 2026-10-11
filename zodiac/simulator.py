"""Isolated retrospective NFL Zodiac experiment; never changes production models."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import math
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANIMALS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig']
STEMS = ['Jia', 'Yi', 'Bing', 'Ding', 'Wu', 'Ji', 'Geng', 'Xin', 'Ren', 'Gui']
BRANCHES = ['Zi', 'Chou', 'Yin', 'Mao', 'Chen', 'Si', 'Wu', 'Wei', 'Shen', 'You', 'Xu', 'Hai']
ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water']
BOUNDARIES = json.loads((ROOT / 'lunar_new_years.json').read_text())
TRINES = [{'Rat', 'Dragon', 'Monkey'}, {'Ox', 'Snake', 'Rooster'}, {'Tiger', 'Horse', 'Dog'}, {'Rabbit', 'Goat', 'Pig'}]


def zodiac(iso):
    try:
        d = date.fromisoformat(iso)
        start = BOUNDARIES[str(d.year)]
    except (ValueError, TypeError, KeyError):
        return None
    year = d.year - (iso < start)
    stem, branch = (year - 4) % 10, (year - 4) % 12
    return dict(sign=ANIMALS[branch], element=ELEMENTS[stem // 2], lunar_year=year,
                gan_zhi=f'{STEMS[stem]}-{BRANCHES[branch]}', convention='lunar_new_year')


def relationship(a, b):
    if a == b:
        return 'same_sign'
    if (ANIMALS.index(a) - ANIMALS.index(b)) % 12 == 6:
        return 'direct_enemy'
    if {a, b} == {'Rat', 'Ox'}:
        return 'rat_ox_special_pair'
    if any(a in group and b in group for group in TRINES):
        return 'same_friend_trine'
    return 'other_or_unclassified'


def digits(value):
    return sum(int(c) for c in str(value) if c.isdigit())


def reduce_number(n, masters=False):
    while n > 9 and not (masters and n in (11, 22, 33)):
        n = digits(n)
    return n


def normalize(team):
    return {'LAR': 'LA', 'STL': 'LA', 'OAK': 'LV', 'SD': 'LAC', 'JAC': 'JAX'}.get(team, team)


def fetch_csv(url, cache):
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / (hashlib.sha256(url.encode()).hexdigest() + '.csv')
    if not destination.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'NFL-Zodiac-Research/0.1.0'})
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read()
        # Save only complete responses; no partial download can poison a rerun.
        temporary = destination.with_suffix('.tmp')
        temporary.write_bytes(content)
        temporary.replace(destination)
    return list(csv.DictReader(io.StringIO(destination.read_text(encoding='utf-8-sig'))))


def team_features(players, day, randomized=False):
    """Unweighted pre-week roster experiment; no actual game snaps or starters."""
    feature = [0.0] * 24  # 12 signs, 5 elements, own/enemy, 5 numerology categories
    ages, cohorts = [], []
    sign = zodiac(day)['sign']
    valid = 0
    for player in players:
        birth = player.get('birth_date')
        z = zodiac(birth)
        if not z or birth > day:
            continue
        valid += 1
        if randomized:
            h = int(hashlib.sha256(player['subject_id'].encode()).hexdigest()[:8], 16)
            z = dict(sign=ANIMALS[h % 12], element=ELEMENTS[(h // 12) % 5])
        feature[ANIMALS.index(z['sign'])] += 1
        feature[12 + ELEMENTS.index(z['element'])] += 1
        feature[17] += z['sign'] == sign
        feature[18] += relationship(z['sign'], sign) == 'direct_enemy'
        lp = reduce_number(digits(birth), True)
        for i, master in enumerate([11, 22, 33]):
            feature[19 + i] += lp == master
        born = date.fromisoformat(birth)
        age = (date.fromisoformat(day) - born).days / 365.2425
        ages.append(age)
        cohorts.append(born.year)
        feature[22] += reduce_number(born.day) / 9
        feature[23] += reduce_number(born.month + born.day + int(day[:4])) / 9
    if not valid:
        return None
    n = len(players)
    return ([v / valid for v in feature], [sum(ages) / valid / 10,
            (sum(cohorts) / valid - 1990) / 10, valid / max(1, n)], valid, n)


def make_examples(games, rosters):
    ratings = defaultdict(lambda: 1500.0)
    roster_index = defaultdict(list)
    for row in rosters:
        roster_index[(int(row['season']), int(row['week']), normalize(row['team']))].append(row)
    examples, skipped = [], defaultdict(int)
    grouped = defaultdict(list)
    for game in games:
        if game['home_score'] == '' or game['away_score'] == '' or not zodiac(game['gameday']):
            continue
        grouped[game['gameday']].append(game)
    previous_season = None
    for day in sorted(grouped):
        season = int(grouped[day][0]['season'])
        if previous_season is not None and season != previous_season:
            ratings = defaultdict(lambda: 1500.0, {t: 1500 + (v - 1500) * 2/3 for t, v in ratings.items()})
        previous_season = season
        updates = []
        for game in grouped[day]:
            home, away = normalize(game['home_team']), normalize(game['away_team'])
            hs, aws = float(game['home_score']), float(game['away_score'])
            sports = [(ratings[home] - ratings[away]) / 400, float(game.get('location') != 'Neutral')]
            result = 0.5 if hs == aws else float(hs > aws)
            expected = 1 / (1 + 10 ** (-(ratings[home] - ratings[away] + sports[1]*55)/400))
            updates.append((home, away, 20*(result-expected)))
            if hs == aws:
                skipped['ties'] += 1
                continue
            # Only prior-week roster: same-game actual participation never used.
            # Week 1 is excluded rather than assuming offseason transfer rosters.
            week = int(game['week'])
            if week <= 1:
                skipped['no_prior_week_roster'] += 1
                continue
            teams = []
            for team in [home, away]:
                players = roster_index.get((season, week - 1, team), [])
                seen = set()
                unique = []
                for player in players:
                    key = player.get('gsis_id') or player.get('espn_id')
                    if key and key not in seen:
                        seen.add(key)
                        unique.append(dict(player, subject_id=key))
                teams.append((team_features(unique, day), team_features(unique, day, True)))
            if any(v is None for pair in teams for v in pair):
                skipped['missing_birthdays_or_roster'] += 1
                continue
            h, a = teams[0][0], teams[1][0]
            rh, ra = teams[0][1], teams[1][1]
            difference = lambda x,y: [u-v for u,v in zip(x,y)]
            symbolic = difference(h[0], a[0])
            random_symbols = difference(rh[0], ra[0])
            controls = difference(h[1], a[1]) + [math.sin(2*math.pi*int(day[5:7])/12), math.cos(2*math.pi*int(day[5:7])/12)]
            examples.append(dict(game_id=game['game_id'], date=day, season=season, y=result,
                sports=sports, symbols=symbolic, controls=controls, randomized=random_symbols))
        # Final scores update ratings only after all that day's features are frozen.
        for home, away, delta in updates:
            ratings[home] += delta
            ratings[away] -= delta
    return examples, dict(skipped)


def fit_predict(train_x, train_y, test_x):
    import numpy as np
    train = np.asarray(train_x, dtype=float)
    test = np.asarray(test_x, dtype=float)
    mean, scale = train.mean(axis=0), train.std(axis=0)
    scale[scale < 1e-6] = 1
    x = np.column_stack([np.ones(len(train)), (train - mean) / scale])
    tx = np.column_stack([np.ones(len(test)), (test - mean) / scale])
    y = np.asarray(train_y)
    beta = np.zeros(x.shape[1])
    ridge = np.eye(x.shape[1]) * 10.0
    ridge[0,0] = 0
    for _ in range(30):
        p = 1 / (1 + np.exp(-np.clip(x @ beta, -30, 30)))
        gradient = x.T @ (p - y) + ridge @ beta
        hessian = (x.T * (p*(1-p))) @ x + ridge + np.eye(x.shape[1])*1e-6
        step = np.linalg.solve(hessian, gradient)
        beta -= step
        if np.max(np.abs(step)) < 1e-7:
            break
    return np.clip(1 / (1 + np.exp(-np.clip(tx @ beta, -30, 30))), 1e-6, 1-1e-6).tolist()


def metrics(y, p):
    n = len(y)
    calibration = 0
    for bucket in range(10):
        idx = [i for i,v in enumerate(p) if min(9,int(v*10)) == bucket]
        if idx:
            calibration += len(idx)/n * abs(sum(p[i] for i in idx)/len(idx) - sum(y[i] for i in idx)/len(idx))
    return dict(sample_size=n, accuracy=sum((v>=0.5)==bool(t) for t,v in zip(y,p))/n,
                log_loss=-sum(t*math.log(v)+(1-t)*math.log(1-v) for t,v in zip(y,p))/n,
                brier_score=sum((v-t)**2 for t,v in zip(y,p))/n, calibration_error=calibration)


def walk_forward(examples, minimum_train_seasons=3):
    models = {'sports_only': lambda e:e['sports'], 'zodiac_only': lambda e:e['symbols'][:19],
              'sports_plus_zodiac': lambda e:e['sports']+e['symbols'][:19],
              'sports_plus_controls': lambda e:e['sports']+e['controls'],
              'controlled_zodiac': lambda e:e['sports']+e['controls']+e['symbols'][:19],
              'randomized_control': lambda e:e['sports']+e['controls']+e['randomized'][:19],
              'zodiac_plus_numerology': lambda e:e['sports']+e['controls']+e['symbols']}
    seasons = sorted({e['season'] for e in examples})
    folds = []
    for season in seasons[minimum_train_seasons:]:
        train = [e for e in examples if e['season'] < season]
        test = [e for e in examples if e['season'] == season]
        if not train or not test:
            continue
        y = [e['y'] for e in test]
        outcomes = {}
        for model, features in models.items():
            probabilities = fit_predict([features(e) for e in train], [e['y'] for e in train], [features(e) for e in test])
            outcomes[model] = metrics(y, probabilities)
        baseline = outcomes['sports_only']
        for values in outcomes.values():
            values['brier_difference_vs_sports'] = values['brier_score'] - baseline['brier_score']
            values['log_loss_difference_vs_sports'] = values['log_loss'] - baseline['log_loss']
        folds.append(dict(test_season=season, train_seasons=sorted({e['season'] for e in train}),
                          train_cutoff=max(e['date'] for e in train), test_start=min(e['date'] for e in test),
                          final_reserved_season=season==seasons[-1], models=outcomes))
    return folds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start-season', type=int, default=2018)
    parser.add_argument('--end-season', type=int, default=2025)
    parser.add_argument('--cache', type=Path, default=ROOT/'.cache')
    parser.add_argument('--output', type=Path, default=ROOT/'output'/'walk-forward.json')
    args = parser.parse_args()
    if not 2002 <= args.start_season <= args.end_season <= datetime.now(timezone.utc).year or args.end_season-args.start_season < 3:
        parser.error('Use at least four seasons, with weekly roster coverage from 2002 onward.')
    games_url = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
    games = [g for g in fetch_csv(games_url,args.cache) if args.start_season <= int(g['season']) <= args.end_season and g['game_type']=='REG']
    rosters = []
    sources = [games_url]
    for season in range(args.start_season,args.end_season+1):
        url = f'https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv'
        print(f'Loading {season} weekly roster...', flush=True)
        sources.append(url)
        # Missing data fails visibly; no current-season or dummy replacement.
        rosters.extend(fetch_csv(url,args.cache))
    examples, skipped = make_examples(games,rosters)
    folds = walk_forward(examples)
    if not folds:
        raise ValueError('Insufficient eligible games for chronological evaluation.')
    report = dict(experiment_id='nfl-zodiac-retrospective-v0.1.0', validation_status='under_evaluation',
        created_at_utc=datetime.now(timezone.utc).isoformat().replace('+00:00','Z'), calendar_convention='lunar_new_year',
        target='Home outright win including overtime, conditional on a non-tied regular-season game', sources=sources,
        eligible_games=len(examples), skipped_games=skipped, method='walk_forward', folds=folds,
        metric_definitions={'accuracy':'Fraction of threshold-0.5 home/away selections correct', 'log_loss':'Mean binary negative log likelihood',
            'brier_score':'Mean squared probability error', 'calibration_error':'Ten equal-width-bin expected calibration error'},
        limitations=['Reconstructed weekly roster files have no verified historical publication timestamps; this is not a certified point-in-time backtest.',
            'Uses prior-week unweighted roster composition, not confirmed starters or projected snaps; week 1 excluded.',
            'Elo is an isolated research baseline, not the existing production football model.',
            'Ridge strength fixed at 10; scaling fitted on training data only. No calibrated or approved deployment artifact produced.',
            'Last season reserved in code and evaluated once; this remains retrospective, not prospective evidence.',
            'No automatic promotion, probability publication, betting ROI, or GG33 proprietary-method claim.'])
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(f'{len(examples)} eligible games; {len(folds)} chronological folds. Report: {args.output}')


if __name__ == '__main__':
    main()
