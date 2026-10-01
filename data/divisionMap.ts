// Division mapping for all 32 NFL teams and a helper to detect divisional matchups.

export const divisionMap: Record<string, string> = {
  ARI: 'NFC West',
  ATL: 'NFC South',
  BAL: 'AFC North',
  BUF: 'AFC East',
  CAR: 'NFC South',
  CHI: 'NFC North',
  CIN: 'AFC North',
  CLE: 'AFC North',
  DAL: 'NFC East',
  DEN: 'AFC West',
  DET: 'NFC North',
  GB: 'NFC North',
  HOU: 'AFC South',
  IND: 'AFC South',
  JAX: 'AFC South',
  KC: 'AFC West',
  LV: 'AFC West',
  LAC: 'AFC West',
  LA: 'NFC West',
  MIA: 'AFC East',
  MIN: 'NFC North',
  NE: 'AFC East',
  NO: 'NFC South',
  NYG: 'NFC East',
  NYJ: 'AFC East',
  PHI: 'NFC East',
  PIT: 'AFC North',
  SF: 'NFC West',
  SEA: 'NFC West',
  TB: 'NFC South',
  TEN: 'AFC South',
  WAS: 'NFC East',
};

export function isDivisionalGame(homeAbbr: string, awayAbbr: string): boolean {
  const homeDiv = divisionMap[homeAbbr];
  const awayDiv = divisionMap[awayAbbr];
  if (!homeDiv || !awayDiv) return false;
  return homeDiv === awayDiv;
}
