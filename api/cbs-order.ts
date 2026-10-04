const CBS_TEAM_ALIASES: Array<{ abbr: string; aliases: string[] }> = [
  { abbr: 'ARI', aliases: ['Arizona'] },
  { abbr: 'ATL', aliases: ['Atlanta'] },
  { abbr: 'BAL', aliases: ['Baltimore'] },
  { abbr: 'BUF', aliases: ['Buffalo'] },
  { abbr: 'CAR', aliases: ['Carolina'] },
  { abbr: 'CHI', aliases: ['Chicago'] },
  { abbr: 'CIN', aliases: ['Cincinnati'] },
  { abbr: 'CLE', aliases: ['Cleveland'] },
  { abbr: 'DAL', aliases: ['Dallas'] },
  { abbr: 'DEN', aliases: ['Denver'] },
  { abbr: 'DET', aliases: ['Detroit'] },
  { abbr: 'GB', aliases: ['Green Bay'] },
  { abbr: 'HOU', aliases: ['Houston'] },
  { abbr: 'IND', aliases: ['Indianapolis'] },
  { abbr: 'JAX', aliases: ['Jacksonville'] },
  { abbr: 'KC', aliases: ['Kansas City'] },
  { abbr: 'LV', aliases: ['Las Vegas'] },
  { abbr: 'LAC', aliases: ['L.A. Chargers', 'LA Chargers', 'Los Angeles Chargers'] },
  { abbr: 'LA', aliases: ['L.A. Rams', 'LA Rams', 'Los Angeles Rams'] },
  { abbr: 'MIA', aliases: ['Miami'] },
  { abbr: 'MIN', aliases: ['Minnesota'] },
  { abbr: 'NE', aliases: ['New England'] },
  { abbr: 'NO', aliases: ['New Orleans'] },
  { abbr: 'NYG', aliases: ['N.Y. Giants', 'NY Giants', 'New York Giants'] },
  { abbr: 'NYJ', aliases: ['N.Y. Jets', 'NY Jets', 'New York Jets'] },
  { abbr: 'PHI', aliases: ['Philadelphia'] },
  { abbr: 'PIT', aliases: ['Pittsburgh'] },
  { abbr: 'SF', aliases: ['San Francisco'] },
  { abbr: 'SEA', aliases: ['Seattle'] },
  { abbr: 'TB', aliases: ['Tampa Bay'] },
  { abbr: 'TEN', aliases: ['Tennessee'] },
  { abbr: 'WAS', aliases: ['Washington'] }
];

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&period;/gi, '.')
    .replace(/&#x2F;/gi, '/')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTeamsInRow(rowHtml: string): string[] {
  const text = decodeHtml(rowHtml);
  const matches: Array<{ abbr: string; index: number }> = [];

  for (const team of CBS_TEAM_ALIASES) {
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const alias of team.aliases) {
      const index = text.indexOf(alias);
      if (index >= 0 && index < bestIndex) bestIndex = index;
    }
    if (Number.isFinite(bestIndex)) matches.push({ abbr: team.abbr, index: bestIndex });
  }

  matches.sort((a, b) => a.index - b.index);
  return matches.map(match => match.abbr);
}

function parseCbsOrder(html: string): Array<{ awayTeam: string; homeTeam: string; order: number }> {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const order: Array<{ awayTeam: string; homeTeam: string; order: number }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const teams = findTeamsInRow(row);
    if (teams.length < 2) continue;
    const awayTeam = teams[0];
    const homeTeam = teams[1];
    if (awayTeam === homeTeam) continue;
    const key = `${awayTeam}@${homeTeam}`;
    if (seen.has(key)) continue;
    seen.add(key);
    order.push({ awayTeam, homeTeam, order: order.length });
  }

  return order;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const season = Number(req.query?.season);
  const week = Number(req.query?.week);
  if (!Number.isInteger(season) || season < 1999 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 18) {
    return res.status(400).json({ error: 'Valid season and regular-season week are required.' });
  }

  const url = `https://www.cbssports.com/nfl/schedule/${season}/regular/${week}/`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,*/*',
        'User-Agent': 'NFL-Predictor-CBS-Order/1.0'
      },
      redirect: 'follow'
    });
    if (!response.ok) {
      return res.status(502).json({ error: `CBS schedule returned HTTP ${response.status}.`, source: url });
    }

    const html = await response.text();
    const games = parseCbsOrder(html);
    if (games.length === 0) {
      return res.status(502).json({ error: 'CBS schedule page was reachable but no matchup rows could be parsed.', source: url });
    }

    return res.status(200).json({
      source: url,
      season,
      week,
      games
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
      source: url
    });
  }
}
