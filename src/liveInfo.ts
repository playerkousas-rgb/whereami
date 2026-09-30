import { formatHkt } from './coordinates';

export type FeedState = 'idle' | 'loading' | 'fresh' | 'cached' | 'unavailable' | 'invalid';
export interface FeedItem { title:string; detail?:string; publishedAt?:string; }
export interface FeedResult { id: string; name: string; source: string; state: FeedState; count?: number; fetchedAt?: string; publishedAt?: string; message: string; items?:FeedItem[]; }

const feeds = [
  { id: 'traffic', name: '封路及交通事故', source: '運輸署', url: 'https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml', kind: 'xml' },
  { id: 'weather', name: '天氣警告', source: '香港天文台', url: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc', kind: 'json' },
  { id: 'trails', name: '封閉山徑', source: '漁農自然護理署／CSDI', url: 'https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1742550096880_1424&format=geojson&layer_name=CPISDBOCLOSED_TRAIL_IN_CP_GDB', kind: 'geojson' },
  { id: 'facilities', name: '關閉郊野設施', source: '漁農自然護理署／CSDI', url: 'https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1728897009646_22480&format=geojson&layer_name=Closed_Facilities_in_Country_Parks', kind: 'geojson' },
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
    if (feed.kind === 'json') {
      const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 結構不符');
      items=Object.entries(data).map(([key,value])=>{const v=value as Record<string,unknown>;return {title:String(v?.name||v?.warningStatementCode||key),detail:typeof v?.actionCode==='string'?v.actionCode:undefined,publishedAt:typeof v?.updateTime==='string'?v.updateTime:undefined}});count=items.length;
    } else if (feed.kind === 'geojson') {
      const data = JSON.parse(text); if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('GeoJSON 結構不符');
      items=data.features.map((f:{properties?:Record<string,unknown>},i:number)=>{const p=f.properties||{};const value=(keys:string[])=>{for(const k of keys){const hit=Object.entries(p).find(([x,v])=>x.toLowerCase().includes(k)&&v);if(hit)return String(hit[1])}return undefined};return {title:value(['name_tc','trail_name_tc','facility_name_tc','name'])||`${feed.name} ${i+1}`,detail:value(['remarks_tc','reason_tc','detail','status']),publishedAt:value(['update','date'])}});count=items.length;
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
