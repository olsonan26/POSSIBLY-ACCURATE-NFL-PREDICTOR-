import { Team } from '../types';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Team/franchise dates preserve the predictor's existing canonical dates.
 * Coach and QB values are 2026 fallbacks only. Live ESPN depth-chart/roster data
 * replaces player personnel whenever available. Owners are intentionally excluded
 * from the scoring model until they demonstrate independent holdout value.
 */
export const TEAM_REGISTRY: Team[] = [
  { name: 'Arizona Cardinals', abbr: 'ARI', birthday: d('1917-01-17'), coach: { name: 'Mike LaFleur', birthday: d('1987-03-03') }, qb: { name: 'Jacoby Brissett', birthday: d('1992-12-11') } },
  { name: 'Atlanta Falcons', abbr: 'ATL', birthday: d('1965-06-30'), coach: { name: 'Kevin Stefanski', birthday: d('1982-05-08') }, qb: { name: 'Tua Tagovailoa', birthday: d('1998-03-02') } },
  { name: 'Baltimore Ravens', abbr: 'BAL', birthday: d('1996-02-09'), coach: { name: 'Jesse Minter', birthday: d('1983-05-09') }, qb: { name: 'Lamar Jackson', birthday: d('1997-01-07') } },
  { name: 'Buffalo Bills', abbr: 'BUF', birthday: d('1959-10-28'), coach: { name: 'Joe Brady', birthday: d('1989-09-23') }, qb: { name: 'Josh Allen', birthday: d('1996-05-21') } },
  { name: 'Carolina Panthers', abbr: 'CAR', birthday: d('1993-10-26'), coach: { name: 'Dave Canales', birthday: d('1981-05-07') }, qb: { name: 'Bryce Young', birthday: d('2001-07-25') } },
  { name: 'Chicago Bears', abbr: 'CHI', birthday: d('1920-09-17'), coach: { name: 'Ben Johnson', birthday: d('1986-05-11') }, qb: { name: 'Caleb Williams', birthday: d('2001-11-18') } },
  { name: 'Cincinnati Bengals', abbr: 'CIN', birthday: d('1967-05-23'), coach: { name: 'Zac Taylor', birthday: d('1983-05-10') }, qb: { name: 'Joe Burrow', birthday: d('1996-12-10') } },
  { name: 'Cleveland Browns', abbr: 'CLE', birthday: d('1944-06-04'), coach: { name: 'Todd Monken', birthday: d('1966-02-05') }, qb: { name: 'Deshaun Watson', birthday: d('1995-09-14') } },
  { name: 'Dallas Cowboys', abbr: 'DAL', birthday: d('1960-01-28'), coach: { name: 'Brian Schottenheimer', birthday: d('1973-10-16') }, qb: { name: 'Dak Prescott', birthday: d('1993-07-29') } },
  { name: 'Denver Broncos', abbr: 'DEN', birthday: d('1959-08-14'), coach: { name: 'Sean Payton', birthday: d('1963-12-29') }, qb: { name: 'Bo Nix', birthday: d('2000-02-25') } },
  { name: 'Detroit Lions', abbr: 'DET', birthday: d('1930-07-12'), coach: { name: 'Dan Campbell', birthday: d('1976-04-13') }, qb: { name: 'Jared Goff', birthday: d('1994-10-14') } },
  { name: 'Green Bay Packers', abbr: 'GB', birthday: d('1919-08-11'), coach: { name: 'Matt LaFleur', birthday: d('1979-11-03') }, qb: { name: 'Jordan Love', birthday: d('1998-11-02') } },
  { name: 'Houston Texans', abbr: 'HOU', birthday: d('1999-10-06'), coach: { name: 'DeMeco Ryans', birthday: d('1984-07-28') }, qb: { name: 'C.J. Stroud', birthday: d('2001-10-03') } },
  { name: 'Indianapolis Colts', abbr: 'IND', birthday: d('1953-01-23'), coach: { name: 'Shane Steichen', birthday: d('1985-05-11') }, qb: { name: 'Daniel Jones', birthday: d('1997-05-27') } },
  { name: 'Jacksonville Jaguars', abbr: 'JAX', birthday: d('1993-11-30'), coach: { name: 'Liam Coen', birthday: d('1985-11-08') }, qb: { name: 'Trevor Lawrence', birthday: d('1999-10-06') } },
  { name: 'Kansas City Chiefs', abbr: 'KC', birthday: d('1959-08-14'), coach: { name: 'Andy Reid', birthday: d('1958-03-19') }, qb: { name: 'Patrick Mahomes', birthday: d('1995-09-17') } },
  { name: 'Las Vegas Raiders', abbr: 'LV', birthday: d('1960-01-30'), coach: { name: 'Klint Kubiak', birthday: d('1987-02-17') }, qb: { name: 'Kirk Cousins', birthday: d('1988-08-19') } },
  { name: 'Los Angeles Chargers', abbr: 'LAC', birthday: d('1959-08-14'), coach: { name: 'Jim Harbaugh', birthday: d('1963-12-23') }, qb: { name: 'Justin Herbert', birthday: d('1998-03-10') } },
  { name: 'Los Angeles Rams', abbr: 'LA', birthday: d('1937-02-12'), coach: { name: 'Sean McVay', birthday: d('1986-01-24') }, qb: { name: 'Matthew Stafford', birthday: d('1988-02-07') } },
  { name: 'Miami Dolphins', abbr: 'MIA', birthday: d('1965-08-16'), coach: { name: 'Jeff Hafley', birthday: d('1979-04-04') }, qb: { name: 'Malik Willis', birthday: d('1999-05-25') } },
  { name: 'Minnesota Vikings', abbr: 'MIN', birthday: d('1960-01-28'), coach: { name: "Kevin O'Connell", birthday: d('1985-05-25') }, qb: { name: 'Kyler Murray', birthday: d('1997-08-07') } },
  { name: 'New England Patriots', abbr: 'NE', birthday: d('1959-11-22'), coach: { name: 'Mike Vrabel', birthday: d('1975-08-14') }, qb: { name: 'Drake Maye', birthday: d('2002-08-30') } },
  { name: 'New Orleans Saints', abbr: 'NO', birthday: d('1966-11-01'), coach: { name: 'Kellen Moore', birthday: d('1988-07-05') }, qb: { name: 'Tyler Shough', birthday: d('1999-09-28') } },
  { name: 'New York Giants', abbr: 'NYG', birthday: d('1925-08-01'), coach: { name: 'John Harbaugh', birthday: d('1962-09-23') }, qb: { name: 'Jaxson Dart', birthday: d('2003-05-13') } },
  { name: 'New York Jets', abbr: 'NYJ', birthday: d('1959-08-14'), coach: { name: 'Aaron Glenn', birthday: d('1972-07-16') }, qb: { name: 'Geno Smith', birthday: d('1990-10-10') } },
  { name: 'Philadelphia Eagles', abbr: 'PHI', birthday: d('1933-07-08'), coach: { name: 'Nick Sirianni', birthday: d('1981-06-15') }, qb: { name: 'Jalen Hurts', birthday: d('1998-08-07') } },
  { name: 'Pittsburgh Steelers', abbr: 'PIT', birthday: d('1933-07-08'), coach: { name: 'Mike McCarthy', birthday: d('1963-11-10') }, qb: { name: 'Aaron Rodgers', birthday: d('1983-12-02') } },
  { name: 'San Francisco 49ers', abbr: 'SF', birthday: d('1946-03-28'), coach: { name: 'Kyle Shanahan', birthday: d('1979-12-14') }, qb: { name: 'Brock Purdy', birthday: d('1999-12-27') } },
  { name: 'Seattle Seahawks', abbr: 'SEA', birthday: d('1972-06-15'), coach: { name: 'Mike Macdonald', birthday: d('1987-06-26') }, qb: { name: 'Sam Darnold', birthday: d('1997-06-05') } },
  { name: 'Tampa Bay Buccaneers', abbr: 'TB', birthday: d('1974-04-24'), coach: { name: 'Todd Bowles', birthday: d('1963-11-18') }, qb: { name: 'Baker Mayfield', birthday: d('1995-04-14') } },
  { name: 'Tennessee Titans', abbr: 'TEN', birthday: d('1959-08-03'), coach: { name: 'Robert Saleh', birthday: d('1979-01-31') }, qb: { name: 'Cam Ward', birthday: d('2002-05-25') } },
  { name: 'Washington Commanders', abbr: 'WAS', birthday: d('1932-07-09'), coach: { name: 'Dan Quinn', birthday: d('1970-09-11') }, qb: { name: 'Jayden Daniels', birthday: d('2000-12-18') } }
];

export const TEAM_BY_ABBR = new Map(TEAM_REGISTRY.map(team => [team.abbr, team]));
export const TEAM_BY_NAME = new Map(TEAM_REGISTRY.map(team => [team.name, team]));

export function normalizeTeamAbbr(value: string): string {
  const v = String(value || '').toUpperCase();
  if (v === 'LAR' || v === 'STL') return 'LA';
  if (v === 'OAK') return 'LV';
  if (v === 'SD') return 'LAC';
  if (v === 'JAC') return 'JAX';
  return v;
}
