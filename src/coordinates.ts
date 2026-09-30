import proj4 from 'proj4';

proj4.defs('EPSG:2326', '+proj=tmerc +lat_0=22.31213333333333 +lon_0=114.1787222222222 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.0677,-2.6556,0.8942,-10.624 +units=m +no_defs');
proj4.defs('EPSG:32649', '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32650', '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs');

type Square = { name: string; eastBase: number };
const squareFor = (zone: number, e: number): Square | null => {
  if (zone === 49 && e >= 700000 && e < 800000) return { name: 'GE', eastBase: 700000 };
  if (zone === 49 && e >= 800000 && e < 900000) return { name: 'HE', eastBase: 800000 };
  if (zone === 50 && e >= 100000 && e < 200000) return { name: 'JK', eastBase: 100000 };
  if (zone === 50 && e >= 200000 && e < 300000) return { name: 'KK', eastBase: 200000 };
  return null;
};

export interface ConvertedCoordinates {
  latitude: number; longitude: number;
  hkE: number; hkN: number;
  zone: number; utmE: number; utmN: number;
  grid6: string; grid8: string;
}

export function convertCoordinates(latitude: number, longitude: number): ConvertedCoordinates {
  const [hkE, hkN] = proj4('EPSG:4326', 'EPSG:2326', [longitude, latitude]);
  const zone = longitude < 114 ? 49 : 50;
  const [utmE, utmN] = proj4('EPSG:4326', `EPSG:326${zone}`, [longitude, latitude]);
  const square = squareFor(zone, utmE);
  let grid6 = '超出香港常用方格';
  let grid8 = '超出香港常用方格';
  if (square) {
    const e = ((Math.round(utmE) - square.eastBase) + 100000) % 100000;
    const n = ((Math.round(utmN) % 100000) + 100000) % 100000;
    grid6 = `${square.name} ${String(Math.floor(e / 100)).padStart(3, '0')} ${String(Math.floor(n / 100)).padStart(3, '0')}`;
    grid8 = `${zone}Q ${square.name} ${String(Math.floor(e / 10)).padStart(4, '0')} ${String(Math.floor(n / 10)).padStart(4, '0')}`;
  }
  return { latitude, longitude, hkE, hkN, zone, utmE, utmN, grid6, grid8 };
}

export function formatHkt(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '時間不明';
  return new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d) + ' HKT';
}
