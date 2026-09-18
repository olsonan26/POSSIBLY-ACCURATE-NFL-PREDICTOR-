const ESPN_TEAM_IDS: Record<string, string> = {
  ARI: '22', ATL: '1', BAL: '33', BUF: '2', CAR: '29', CHI: '3', CIN: '4', CLE: '5',
  DAL: '6', DEN: '7', DET: '8', GB: '9', HOU: '34', IND: '11', JAX: '30', KC: '12',
  LV: '13', LAC: '24', LA: '14', MIA: '15', MIN: '16', NE: '17', NO: '18', NYG: '19',
  NYJ: '20', PHI: '21', PIT: '23', SF: '25', SEA: '26', TB: '27', TEN: '10', WAS: '28'
};

const allowedDatasets = new Set(['games', 'roster', 'depth', 'injuries']);

function asString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dataset = asString(req.query?.dataset).toLowerCase();
  const team = asString(req.query?.team).toUpperCase();

  if (!allowedDatasets.has(dataset)) {
    return res.status(400).json({ error: 'Invalid dataset' });
  }

  let url = '';
  let contentType = 'application/json; charset=utf-8';

  if (dataset === 'games') {
    url = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
    contentType = 'text/csv; charset=utf-8';
  } else {
    const teamId = ESPN_TEAM_IDS[team];
    if (!teamId) return res.status(400).json({ error: 'Invalid or missing team abbreviation' });

    const resource = dataset === 'roster' ? 'roster' : dataset === 'depth' ? 'depthcharts' : 'injuries';
    url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/${resource}`;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'Accept': dataset === 'games' ? 'text/csv,*/*' : 'application/json,*/*',
        'User-Agent': 'NFL-Predictor-Accuracy-Engine/2.0'
      },
      redirect: 'follow'
    });

    if (!upstream.ok) {
      return res.status(502).json({
        error: 'Upstream NFL data source failed',
        dataset,
        status: upstream.status
      });
    }

    const body = await upstream.text();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', dataset === 'games'
      ? 's-maxage=1800, stale-while-revalidate=21600'
      : 's-maxage=300, stale-while-revalidate=1800');
    res.setHeader('X-Data-Source', dataset === 'games' ? 'nflverse/nfldata' : 'ESPN public NFL endpoint');
    return res.status(200).send(body);
  } catch (error) {
    console.error('NFL data proxy error', error);
    return res.status(502).json({ error: 'Unable to retrieve NFL data', dataset });
  }
}
