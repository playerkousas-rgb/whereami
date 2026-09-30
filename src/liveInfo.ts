import { formatHkt } from './coordinates';

export type FeedState = 'idle' | 'loading' | 'fresh' | 'cached' | 'unavailable' | 'invalid';
export interface FeedItem { title:string; detail?:string; publishedAt?:string; lat?:number; lng?:number; statusBadge?:string; }
export interface FeedResult { id: string; name: string; source: string; state: FeedState; count?: number; fetchedAt?: string; publishedAt?: string; message: string; items?:FeedItem[]; }

const feeds = [
  { id: 'weather-now', name: '現在天氣', source: '香港天文台', url: '/api/live/weather-now', kind: 'weather-now' },
  { id: 'traffic', name: '封路及交通事故', source: '運輸署', url: '/api/live/traffic', kind: 'xml' },
  { id: 'weather', name: '天氣警告', source: '香港天文台', url: '/api/live/weather', kind: 'json' },
  { id: 'trails', name: '封閉山徑', source: '漁農自然護理署／CSDI', url: '/api/live/trails', kind: 'geojson' },
  { id: 'facilities', name: '關閉郊野設施', source: '漁農自然護理署／CSDI', url: '/api/live/facilities', kind: 'geojson' },
] as const;

const key = (id: string) => `whereami-feed-${id}`;
const cache = (r: FeedResult) => { try { localStorage.setItem(key(r.id), JSON.stringify(r)); } catch { /* storage unavailable */ } };
export function cachedFeeds(): FeedResult[] { return feeds.map(f => { try { const v = localStorage.getItem(key(f.id)); if (v) return { ...JSON.parse(v), state: 'cached' as const, message: '正在顯示最後成功取得的資料，可能已過時' }; } catch { /* invalid cache */ } return { id: f.id, name: f.name, source: f.source, state: 'idle' as const, message: '尚未取得即時資料' }; }); }

export function translateStatus(s?: string): string {
  if (!s) return '';
  const t = s.trim();
  if (/temporary closed/i.test(t)) return '暫時封閉';
  if (/temporary diversion/i.test(t)) return '臨時改道';
  if (/partially closed/i.test(t)) return '部分封閉';
  if (/closed/i.test(t)) return '封閉';
  if (/diversion/i.test(t)) return '改道';
  if (/maintenance/i.test(t)) return '維修中';
  if (/open/i.test(t)) return '正常開放';
  return t;
}

export function normalizeDateStr(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  // ArcGIS/CSDI 日期欄位（如 EFFECTIVE_DATE）以 epoch 毫秒（有時是秒）表示，須轉成人類可讀的 HKT 日期。
  if (/^\d{12,14}$/.test(s)) {
    const ms = s.length === 10 ? Number(s) * 1000 : Number(s);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const hkt = new Date(ms + 8 * 3600 * 1000); // 香港官方資料以 HKT 表示
      const p = (n: number) => String(n).padStart(2, '0');
      return `${hkt.getUTCFullYear()}-${p(hkt.getUTCMonth() + 1)}-${p(hkt.getUTCDate())} ${p(hkt.getUTCHours())}:${p(hkt.getUTCMinutes())}`;
    }
    return s;
  }
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (/^\d{8}\s*\d{4}$/.test(s)) {
    const d = s.replace(/\s+/, '');
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`;
  }
  return s;
}

const WARNING_NAMES: Record<string, string> = {
  WFIREY: '黃色火災危險警告',
  WFIRER: '紅色火災危險警告',
  WRAINY: '黃色暴雨警告信號',
  WRAINR: '紅色暴雨警告信號',
  WRAINB: '黑色暴雨警告信號',
  WTS: '雷暴警告',
  WHOT: '酷熱天氣警告',
  VHOT: '極端酷熱天氣提示',
  WCOLD: '寒冷天氣警告',
  WMSGNL: '特別天氣提示',
  WLANDSLIP: '山泥傾瀉警告',
  WTCS: '熱帶氣旋警告信號',
  WFROST: '霜凍警告',
  WTMW: '海嘯警告',
};

async function fetchOne(feed: typeof feeds[number]): Promise<FeedResult> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch(feed.url, { signal: ctrl.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('空白回應');
    let count = 0; let items:FeedItem[]=[];
    if (feed.kind === 'weather-now') {
      const data = JSON.parse(text); if (!data || typeof data !== 'object') throw new Error('JSON 結構不符');
      const publishedAt = typeof data.updateTime === 'string' ? data.updateTime : undefined;
      const temps:Array<{place:string;value:number;unit:string}> = Array.isArray(data.temperature?.data) ? data.temperature.data : [];
      const pick = (place:string) => temps.find(t => t.place === place);
      const hko = pick('香港天文台') || temps[0];
      const spread = temps.length ? `${Math.min(...temps.map(t=>t.value))}–${Math.max(...temps.map(t=>t.value))}°C（全港${temps.length}個測站）` : undefined;
      if (hko) items.push({ title: '現時氣溫', detail: `${hko.place} ${hko.value}°C${spread ? `；全港氣溫介乎 ${spread}` : ''}`, publishedAt: data.temperature?.recordTime || publishedAt });
      const hum = Array.isArray(data.humidity?.data) ? data.humidity.data[0] : undefined;
      if (hum) items.push({ title: '相對濕度', detail: `${hum.place} ${hum.value}%`, publishedAt: data.humidity?.recordTime || publishedAt });
      const uv = Array.isArray(data.uvindex?.data) ? data.uvindex.data[0] : undefined;
      if (uv) items.push({ title: '紫外線指數', detail: `${uv.place} ${uv.value}（強度：${uv.desc}）`, publishedAt });
      const rain = Array.isArray(data.rainfall?.data) ? data.rainfall.data.filter((r:{max:number})=>r.max>0) : [];
      items.push({ title: '雨量記錄', detail: rain.length ? rain.map((r:{place:string;max:number;unit:string})=>`${r.place} ${r.max}${r.unit}`).join('、') : '過去一小時全港各區未錄得顯著降雨', publishedAt: data.rainfall?.endTime || publishedAt });
      const warnings:string[] = Array.isArray(data.warningMessage) ? data.warningMessage.filter((w:unknown)=>typeof w === 'string' && w.trim()) : [];
      if (warnings.length) warnings.forEach(w => items.push({ title: '特別天氣提示', detail: w, publishedAt }));
      count = items.length;
    } else if (feed.kind === 'json') {
      const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 結構不符');
      items = Object.entries(data).map(([key, value]) => {
        const v = value as Record<string, unknown>;
        const rawName = String(v?.name || v?.warningStatementCode || key);
        const name = WARNING_NAMES[key] || WARNING_NAMES[rawName] || rawName;
        const rawAction = typeof v?.actionCode === 'string' ? v.actionCode : '';
        const action = rawAction === 'ISSUE' ? '⚠️ 現正生效' : rawAction === 'REISSUE' ? '⚠️ 維持生效' : rawAction === 'CANCEL' ? '已取消' : rawAction === 'EXTEND' ? '延長生效' : rawAction || '發布中';
        const pub = typeof v?.updateTime === 'string' ? v.updateTime : typeof v?.issueTime === 'string' ? v.issueTime : undefined;
        return {
          title: name,
          detail: `狀態：${action}`,
          publishedAt: pub ? formatHkt(pub) : undefined,
          statusBadge: rawAction === 'CANCEL' ? '已取消' : '生效中',
        };
      });
      count = items.length;
    } else if (feed.kind === 'geojson') {
      const data = JSON.parse(text); if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('GeoJSON 結構不符');
      items = data.features.map((f: { properties?: Record<string, unknown> }, i: number) => {
        const p = f.properties || {};
        const value = (keys: string[]) => {
          for (const k of keys) {
            const hit = Object.entries(p).find(([x, v]) => x.toLowerCase().includes(k) && v != null && v !== '');
            if (hit) return String(hit[1]).trim();
          }
          return undefined;
        };
        const park = value(['country_park_tc', 'cp_name_tc', 'park_name_tc', 'country_park', 'location_tc']);
        const rawName = value(['facility_tc', 'facility_name_tc', 'trail_name_tc', 'name_tc', 'fac_name_tc', 'facility', 'fac_type_tc', 'name', 'trail_name']);
        const title = rawName ? (park && !rawName.includes(park) ? `${park} · ${rawName}` : rawName) : `${feed.name} ${i + 1}`;
        const rawStatus = value(['status_tc', 'status']);
        const statusText = translateStatus(rawStatus);
        // 漁護署 CSDI 數據集以 EXPECTED_EXPIRY_DATE 註明封閉期限（如 "Until further notice"）。
        const expiryRaw = value(['expected_expiry']);
        const expiry = expiryRaw === 'Until further notice' ? '直至另行通知' : expiryRaw;
        const remarks = value(['remarks_tc', 'reason_tc', 'remarks', 'reason', 'detail_tc', 'detail']);
        const detailParts = [statusText, expiry, remarks].filter(Boolean);
        const detail = detailParts.join(' — ') || undefined;
        const geometry = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
        const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates as number[] : [];
        const lat = Number(p.lat ?? p.latitude ?? p.y ?? (geometry?.type === 'Point' ? coords[1] : NaN));
        const lng = Number(p.lng ?? p.longitude ?? p.x ?? (geometry?.type === 'Point' ? coords[0] : NaN));
        return {
          title,
          detail,
          publishedAt: normalizeDateStr(value(['update_date', 'update', 'date', 'start_date', 'announcedate', 'announced_date'])),
          lat: Number.isFinite(lat) ? lat : undefined,
          lng: Number.isFinite(lng) ? lng : undefined,
          statusBadge: statusText || undefined,
        };
      });
      count = items.length;
    } else {
      const doc = new DOMParser().parseFromString(text, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('XML 格式錯誤');
      if (!doc.documentElement || doc.documentElement.nodeName.toLowerCase() === 'html') throw new Error('收到非預期網頁');
      const nodes = [...doc.querySelectorAll('message, item, special_traffic_news, SpecialTrafficNews, INCIDENT, incident, message_item')];
      items = nodes.map((n, i) => {
        const findField = (...tags: string[]) => {
          for (const t of tags) {
            const el = n.getElementsByTagName(t)[0] || n.querySelector(t);
            if (el?.textContent?.trim()) return el.textContent.trim();
          }
          for (const child of Array.from(n.children)) {
            const name = child.nodeName.toLowerCase();
            if (tags.some(t => name === t.toLowerCase() || name.includes(t.toLowerCase())) && child.textContent?.trim()) {
              return child.textContent.trim();
            }
          }
          return undefined;
        };
        const location = findField('LOCATION_CN', 'LOCATION_TC', 'ROAD_CLOSED', 'LOCATION_EN');
        const direction = findField('DIRECTION_CN', 'DIRECTION_TC', 'DIRECTION_EN');
        const district = findField('DISTRICT_CN', 'DISTRICT_TC', 'DISTRICT');
        const nearLandmark = findField('NEAR_LANDMARK_CN', 'NEAR_LANDMARK');
        const rawHeading = findField('INCIDENT_HEADING_CN', 'INCIDENT_HEADING_TC', 'INCIDENT_HEADING', 'ChinShortText', 'ChinText', 'heading_tc', 'heading_cn', 'heading', 'title', 'Heading', 'IncidentHeading', 'headline', 'subject', 'INCIDENT_HEADING_EN');
        // 運輸署第二代：INCIDENT_DETAIL_CN 只是事故性質（如「交通意外」），完整內容在 CONTENT_CN。
        const rawNature = findField('INCIDENT_DETAIL_CN', 'INCIDENT_DETAIL_TC', 'INCIDENT_DETAIL');
        const rawDetail = findField('CONTENT_CN', 'CONTENT', 'INCIDENT_DETAIL_CN', 'INCIDENT_DESC', 'ChinText', 'detail_tc', 'detail_cn', 'description', 'Content', 'IncidentDetail', 'detail', 'desc', 'INCIDENT_DETAIL_EN');
        const rawStatus = findField('INCIDENT_STATUS_CN', 'INCIDENT_STATUS');
        const statusBadge = rawStatus === 'NEW' ? '最新情況' : rawStatus === 'UPDATED' ? '更新情況' : rawStatus === 'CLOSED' ? '完結' : rawStatus || undefined;
        let title = rawHeading || `交通消息 ${i + 1}`;
        if (location && rawHeading && !rawHeading.includes(location)) {
          const dirPart = direction && !location.includes(direction) ? `（往${direction}方向）` : '';
          const naturePart = rawNature && rawNature !== rawHeading ? `：${rawNature}` : '';
          title = `${location}${dirPart} · ${rawHeading}${naturePart}`;
        }
        const latNum = Number(findField('LATITUDE', 'latitude'));
        const lngNum = Number(findField('LONGITUDE', 'longitude'));
        const detailParts = [district, nearLandmark ? `近${nearLandmark}` : '', rawDetail].filter(Boolean);
        return {
          title,
          detail: detailParts.join(' — ') || undefined,
          publishedAt: normalizeDateStr(findField('ANNOUNCEMENT_DATE', 'INCIDENT_DATE', 'date', 'pubDate', 'AnnounceDate', 'reference_date', 'ANNOUNCEDATE', 'INCIDENT_TIME', 'time', 'IncidentDate')),
          lat: Number.isFinite(latNum) && latNum >= 22 && latNum <= 23 ? latNum : undefined,
          lng: Number.isFinite(lngNum) && lngNum >= 113 && lngNum <= 115 ? lngNum : undefined,
          statusBadge,
        };
      });
      count = items.length;
      if (!nodes.length && doc.documentElement.children.length) throw new Error('XML 結構與預期不符');
    }
    // 成功時以官方今次完整快照取代舊快取，絕不把已移除的舊消息混入目前狀態。
    // 只有可解析的官方時間才排序；沒有時間的項目保持官方原有次序，避免猜測先後。
    items = items.map((item, index) => ({ ...item, _index: index }))
      .sort((a, b) => {
        const at = a.publishedAt ? Date.parse(a.publishedAt) : Number.NaN;
        const bt = b.publishedAt ? Date.parse(b.publishedAt) : Number.NaN;
        if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
        if (Number.isFinite(at)) return -1;
        if (Number.isFinite(bt)) return 1;
        return a._index - b._index;
      })
      .map(({ _index: _discard, ...item }) => item);
    const result: FeedResult = { id: feed.id, name: feed.name, source: feed.source, state: 'fresh', count, items, fetchedAt: new Date().toISOString(), message: count ? `成功取得官方目前發布的 ${count} 項資料` : '成功取得官方目前資料；目前沒有已發布項目' };
    cache(result); return result;
  } catch (e) {
    let old: FeedResult | null = null; try { old = JSON.parse(localStorage.getItem(key(feed.id)) || 'null'); } catch { /* no cache */ }
    const reason = e instanceof Error ? e.message : '未知錯誤';
    if (old) return { ...old, state: 'cached', message: `暫時未能取得最新資料（${reason}）；正在顯示舊快取` };
    return { id: feed.id, name: feed.name, source: feed.source, state: reason.includes('JSON') || reason.includes('XML') || reason.includes('結構') ? 'invalid' : 'unavailable', message: `暫時未能收到資料（${reason}）。這不代表目前沒有警告。` };
  } finally { clearTimeout(timer); }
}

export async function refreshAll(onUpdate: (r: FeedResult) => void): Promise<void> { await Promise.allSettled(feeds.map(async f => { const r = await fetchOne(f); onUpdate(r); })); }
export const stateLabel = (f: FeedResult) => f.state === 'fresh' ? '最新發布' : f.state === 'cached' ? '使用快取' : f.state === 'loading' ? '更新中' : f.state === 'invalid' ? '資料格式異常' : f.state === 'unavailable' ? '暫時未能連線' : '尚未更新';
export const feedTime = (f: FeedResult) => f.fetchedAt ? formatHkt(f.fetchedAt) : '從未成功抓取';
