// Stadium coordinates, timezone offsets, roof types, and divisions for all 32 NFL teams.
// Coordinates are for the team's home stadium.
// tzOffset is hours from UTC during NFL regular season (DST period, Sep–Oct).
// Arizona does not observe DST, so it stays at UTC-7.

export interface StadiumInfo {
  lat: number;
  lon: number;
  tzOffset: number;
  roof: 'dome' | 'outdoor' | 'retractable';
  division: string;
}

export const stadiumCoordinates: Record<string, StadiumInfo> = {
  ARI: { lat: 33.5276, lon: -112.2626, tzOffset: -7, roof: 'retractable', division: 'NFC West' },
  ATL: { lat: 33.7557, lon: -84.4008, tzOffset: -4, roof: 'retractable', division: 'NFC South' },
  BAL: { lat: 39.2782, lon: -76.6224, tzOffset: -4, roof: 'outdoor', division: 'AFC North' },
  BUF: { lat: 42.7738, lon: -78.7870, tzOffset: -4, roof: 'outdoor', division: 'AFC East' },
  CAR: { lat: 35.2259, lon: -80.8526, tzOffset: -4, roof: 'outdoor', division: 'NFC South' },
  CHI: { lat: 41.8623, lon: -87.6167, tzOffset: -5, roof: 'outdoor', division: 'NFC North' },
  CIN: { lat: 39.0952, lon: -84.5160, tzOffset: -4, roof: 'outdoor', division: 'AFC North' },
  CLE: { lat: 41.5060, lon: -81.6996, tzOffset: -4, roof: 'outdoor', division: 'AFC North' },
  DAL: { lat: 32.7473, lon: -97.0945, tzOffset: -5, roof: 'retractable', division: 'NFC East' },
  DEN: { lat: 39.7439, lon: -105.0201, tzOffset: -6, roof: 'outdoor', division: 'AFC West' },
  DET: { lat: 42.3400, lon: -83.0455, tzOffset: -4, roof: 'dome', division: 'NFC North' },
  GB: { lat: 44.5013, lon: -88.0622, tzOffset: -5, roof: 'outdoor', division: 'NFC North' },
  HOU: { lat: 29.6847, lon: -95.4107, tzOffset: -5, roof: 'retractable', division: 'AFC South' },
  IND: { lat: 39.7601, lon: -86.1639, tzOffset: -4, roof: 'retractable', division: 'AFC South' },
  JAX: { lat: 30.3239, lon: -81.6373, tzOffset: -4, roof: 'outdoor', division: 'AFC South' },
  KC: { lat: 39.0489, lon: -94.4839, tzOffset: -5, roof: 'outdoor', division: 'AFC West' },
  LV: { lat: 36.0909, lon: -115.1839, tzOffset: -7, roof: 'dome', division: 'AFC West' },
  LAC: { lat: 33.9536, lon: -118.3389, tzOffset: -7, roof: 'dome', division: 'AFC West' },
  LA: { lat: 33.9536, lon: -118.3389, tzOffset: -7, roof: 'dome', division: 'NFC West' },
  MIA: { lat: 25.9580, lon: -80.2389, tzOffset: -4, roof: 'outdoor', division: 'AFC East' },
  MIN: { lat: 44.9737, lon: -93.2583, tzOffset: -5, roof: 'dome', division: 'NFC North' },
  NE: { lat: 42.0909, lon: -71.2643, tzOffset: -4, roof: 'outdoor', division: 'AFC East' },
  NO: { lat: 29.9511, lon: -90.0812, tzOffset: -5, roof: 'dome', division: 'NFC South' },
  NYG: { lat: 40.8128, lon: -74.0742, tzOffset: -4, roof: 'outdoor', division: 'NFC East' },
  NYJ: { lat: 40.8128, lon: -74.0742, tzOffset: -4, roof: 'outdoor', division: 'AFC East' },
  PHI: { lat: 39.9008, lon: -75.1674, tzOffset: -4, roof: 'outdoor', division: 'NFC East' },
  PIT: { lat: 40.4468, lon: -80.0158, tzOffset: -4, roof: 'outdoor', division: 'AFC North' },
  SF: { lat: 37.4030, lon: -121.9690, tzOffset: -7, roof: 'outdoor', division: 'NFC West' },
  SEA: { lat: 47.5952, lon: -122.3316, tzOffset: -7, roof: 'outdoor', division: 'NFC West' },
  TB: { lat: 27.9759, lon: -82.5033, tzOffset: -4, roof: 'outdoor', division: 'NFC South' },
  TEN: { lat: 36.1665, lon: -86.7713, tzOffset: -5, roof: 'outdoor', division: 'AFC South' },
  WAS: { lat: 38.9078, lon: -76.8643, tzOffset: -4, roof: 'outdoor', division: 'NFC East' },
};
