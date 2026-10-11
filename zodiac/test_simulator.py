import unittest
from simulator import zodiac, relationship, reduce_number, make_examples, walk_forward


class SimulatorTests(unittest.TestCase):
    def test_year_boundaries_and_reciprocity(self):
        self.assertEqual(zodiac('2026-02-16')['sign'], 'Snake')
        self.assertEqual(zodiac('2026-02-17')['sign'], 'Horse')
        self.assertEqual(zodiac('1997-01-07')['sign'], 'Rat')
        self.assertIsNone(zodiac('2026-02-30'))
        self.assertEqual(relationship('Horse','Rat'), relationship('Rat','Horse'))
        self.assertEqual(relationship('Horse','Goat'),'other_or_unclassified')
        self.assertEqual(reduce_number(29,True),11)

    def test_prior_week_and_same_day_score_isolation(self):
        games = [dict(game_id='g1',season='2024',week='2',gameday='2024-09-15',home_team='PHI',away_team='DAL',home_score='21',away_score='7',location='Home'),
                 dict(game_id='g2',season='2024',week='2',gameday='2024-09-15',home_team='DAL',away_team='PHI',home_score='14',away_score='28',location='Home')]
        players=[dict(season='2024',week='1',team='PHI',gsis_id='p1',birth_date='1997-01-07'),
                 dict(season='2024',week='1',team='DAL',gsis_id='p2',birth_date='1995-09-17'),
                 dict(season='2024',week='2',team='DAL',gsis_id='wrong',birth_date='2000-01-01')]
        examples,_=make_examples(games,players)
        games[0]['home_score']='70'
        changed,_=make_examples(games,players)
        self.assertEqual(examples[1]['sports'],changed[1]['sports'])
        self.assertEqual(examples[0]['sports'],changed[0]['sports'])
        self.assertEqual(examples[0]['symbols'],changed[0]['symbols'])
        games[0]['week']='1'
        _,skipped=make_examples(games,players)
        self.assertEqual(skipped['no_prior_week_roster'],1)

    def test_walk_forward_never_trains_on_test_season(self):
        examples=[dict(game_id=str((year,i)),date=f'{year}-09-{i+1:02}',season=year,y=i%2,
                  sports=[float(i%3),1],symbols=[0.01*(i%5)]*24,controls=[0.1]*5,randomized=[0.02]*24)
                  for year in range(2018,2023) for i in range(20)]
        folds=walk_forward(examples)
        self.assertEqual([f['test_season'] for f in folds],[2021,2022])
        for fold in folds:
            self.assertLess(max(fold['train_seasons']),fold['test_season'])
            for result in fold['models'].values():
                self.assertEqual(result['sample_size'],20)
                self.assertTrue(0 <= result['brier_score'] <= 1)
        self.assertTrue(folds[-1]['final_reserved_season'])


if __name__=='__main__':
    unittest.main()
