import { formatHkt } from './coordinates';

export type FeedState = 'idle' | 'loading' | 'fresh' | 'cached' | 'unavailable' | 'invalid';
export interface FeedItem { title:string; detail?:string; publishedAt?:string; lat?:number; lng?:number; }
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
      if (hko) items.push({ title: '現時氣溫', detail: `${hko.place} ${hko.value}°C${spread ? `；${spread}` : ''}`, publishedAt: data.temperature?.recordTime || publishedAt });
      const hum = Array.isArray(data.humidity?.data) ? data.humidity.data[0] : undefined;
      if (hum) items.push({ title: '相對濕度', detail: `${hum.place} ${hum.value}%`, publishedAt: data.humidity?.recordTime || publishedAt });
      const uv = Array.isArray(data.uvindex?.data) ? data.uvindex.data[0] : undefined;
      if (uv) items.push({ title: '紫外線指數', detail: `${uv.place} ${uv.value}（${uv.desc}）`, publishedAt });
      const rain = Array.isArray(data.rainfall?.data) ? data.rainfall.data.filter((r:{max:number})=>r.max>0) : [];
      items.push({ title: '雨量', detail: rain.length ? rain.map((r:{place:string;max:number;unit:string})=>`${r.place} ${r.max}${r.unit}`).join('、') : '過去一小時各區雨量錄得 0（官方沒有提供雨量不代表沒有降雨風險）', publishedAt: data.rainfall?.endTime || publishedAt });
      const warnings:string[] = Array.isArray(data.warningMessage) ? data.warningMessage.filter((w:unknown)=>typeof w === 'string' && w.trim()) : [];
      if (warnings.length) warnings.forEach(w => items.push({ title: '天氣提示', detail: w, publishedAt }));
      else items.push({ title: '天氣提示', detail: '官方目前沒有發出特別天氣提示', publishedAt });
      count = items.length;
    } else if (feed.kind === 'json') {
      const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 結構不符');
      items=Object.entries(data).map(([key,value])=>{const v=value as Record<string,unknown>;return {title:String(v?.name||v?.warningStatementCode||key),detail:typeof v?.actionCode==='string'?v.actionCode:undefined,publishedAt:typeof v?.updateTime==='string'?v.updateTime:undefined}});count=items.length;
    } else if (feed.kind === 'geojson') {
      const data = JSON.parse(text); if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('GeoJSON 結構不符');
      items=data.features.map((f:{properties?:Record<string,unknown>},i:number)=>{const p=f.properties||{};const value=(keys:string[])=>{for(const k of keys){const hit=Object.entries(p).find(([x,v])=>x.toLowerCase().includes(k)&&v);if(hit)return String(hit[1])}return undefined};const geometry=(f as {geometry?:{type?:string;coordinates?:unknown}}).geometry; const coords=Array.isArray(geometry?.coordinates)?geometry.coordinates as number[]:[]; const lat=Number(p.lat??p.latitude??p.y??(geometry?.type==='Point'?coords[1]:NaN)); const lng=Number(p.lng??p.longitude??p.x??(geometry?.type==='Point'?coords[0]:NaN)); return {title:value(['name_tc','trail_name_tc','facility_name_tc','name'])||`${feed.name} ${i+1}`,detail:value(['remarks_tc','reason_tc','detail','status']),publishedAt:value(['update','date']),lat:Number.isFinite(lat)?lat:undefined,lng:Number.isFinite(lng)?lng:undefined}});count=items.length;
    } else {
      const doc = new DOMParser().parseFromString(text, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('XML 格式錯誤');
      if (!doc.documentElement || doc.documentElement.nodeName.toLowerCase() === 'html') throw new Error('收到非預期網頁');
      const nodes=[...doc.querySelectorAll('message, item, special_traffic_news, SpecialTrafficNews')];
      items=nodes.map((n,i)=>{const value=(names:string)=>n.querySelector(names)?.textContent?.trim();return {title:value('heading, title, Heading, IncidentHeading')||`交通消息 ${i+1}`,detail:value('content, description, Content, IncidentDetail'),publishedAt:value('date, pubDate, AnnounceDate, reference_date')}});count=items.length;
      if(!nodes.length && doc.documentElement.children.length) throw new Error('XML 結構與預期不符');
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
export const stateLabel = (f: FeedResult) => f.state === 'fresh' ? '已更新' : f.state === 'cached' ? '使用快取' : f.state === 'loading' ? '更新中' : f.state === 'invalid' ? '資料格式異常' : f.state === 'unavailable' ? '暫時未能收到資料' : '尚未更新';
export const feedTime = (f: FeedResult) => f.fetchedAt ? formatHkt(f.fetchedAt) : '從未成功抓取';
