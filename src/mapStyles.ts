// Shared, framework-agnostic map label/colour constants.
// Deliberately has ZERO dependency on leaflet or LocationMap.tsx so that main.tsx can use
// these colours/labels (e.g. for the on-screen legend) without pulling the ~350kB Leaflet
// bundle into the main chunk — LocationMap itself is loaded lazily (see main.tsx).

// 標距柱／燈柱的名稱例如「標距柱 M047」「燈柱 CW1234A」，取最後一節作為現場柱號標籤，
// 讓使用者可直接對照現場實物編號，而不是只看到一個沒有意義的顏色點。
export const extractCode = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  return last && last !== name ? last : '';
};

export const FACILITY_COLORS: Record<string, string> = {
  aed: '#c93434',
  toilet: '#5577b8',
  water: '#168b9b',
  distance_post: '#7652a8',
  fire_station: '#d65a31',
  ambulance_station: '#d63568',
  police: '#334e8a',
  hospital: '#bd3c72',
  other: '#69756e',
};

export const ALERT_COLOR = '#d26b2f';

export const shortLabel: Record<string, (f: { type: string; name: string }) => string> = {
  distance_post: f => extractCode(f.name) || '柱',
  other: f => extractCode(f.name) || '？',
  aed: () => 'AED',
  toilet: () => '廁',
  water: () => '水',
  fire_station: () => '消',
  ambulance_station: () => '救',
  police: () => '警',
  hospital: () => '急',
};
