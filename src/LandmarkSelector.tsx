import { useMemo, useState } from 'react';
import { distanceMeters, facilityName, formatDistance, nearestFacilities, normalizeCode, type Facility, type FacilityDatabase, type FacilityType } from './facilities';
import { findLampPost } from './lampposts';

interface Props {
  database: FacilityDatabase | null;
  position: { lat: number; lng: number } | null;
  installedLamps: string[];
  selected: Facility | null;
  onSelect: (place: Facility) => void;
  onClear: () => void;
}
type SearchKind = 'distance_post' | 'lamp_post' | 'water' | 'toilet' | 'aed';
const OPTIONS: { id: SearchKind; label: string; placeholder: string }[] = [
  { id: 'distance_post', label: '標距柱', placeholder: '例如 M047、L0123，或山徑名稱' },
  { id: 'lamp_post', label: '燈柱', placeholder: '輸入燈柱編號，例如 GD1234' },
  { id: 'water', label: '加水站', placeholder: '搜尋加水站名稱或附近地點' },
  { id: 'toilet', label: '公廁', placeholder: '搜尋公廁名稱或地點' },
  { id: 'aed', label: 'AED', placeholder: '搜尋 AED 設置地點' },
];

export default function LandmarkSelector({ database, position, installedLamps, selected, onSelect, onClear }: Props) {
  const [kind, setKind] = useState<SearchKind>('distance_post');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Facility | null>(null);
  const option = OPTIONS.find(x => x.id === kind)!;
  const matches = useMemo(() => {
    if (!database) return [];
    if (kind === 'lamp_post') return [];
    const items = database.items.filter(x => x.type === kind);
    const q = normalizeCode(query);
    if (q) return items.filter(x => normalizeCode(`${x.name} ${x.id} ${x.detail || ''} ${x.address || ''}`).includes(q)).slice(0, 6);
    if (position) return nearestFacilities(database, position.lat, position.lng, kind as FacilityType, 6);
    return [];
  }, [database, kind, query, position?.lat, position?.lng]);

  const choose = (item: Facility) => {
    setPending(item);
    const gap = position ? distanceMeters(position.lat, position.lng, item.lat, item.lng) : null;
    const kindName = item.source === '路政署燈柱資料' ? '燈柱' : facilityName[item.type];
    setMessage(`找到${kindName}官方座標${gap == null ? '' : `；與裝置定位相距 ${formatDistance(gap)}`}。核對現場編號並確認你就在旁邊，才可用作位置參考。`);
  };
  const confirmPending = () => {
    if (!pending) return;
    onSelect(pending);
    setMessage(`已確認${pending.name}；報位會標示為現場地標參考，不等同測量出你與地標的精確距離。`);
    setPending(null);
  };

  const checkLamp = async () => {
    const code = normalizeCode(query);
    if (!code) { setMessage('請輸入燈柱上的完整編號。'); return; }
    if (!installedLamps.length) { setMessage('尚未下載燈柱資料。請先到「下載」下載所在區域的燈柱資料；山徑定位可改用標距柱。'); return; }
    try {
      const lamp = await findLampPost(code);
      if (!lamp) { setMessage('找不到完全相符的燈柱編號；請核對字母及數字，或確認已下載該區資料。'); return; }
      choose({ id: `lamp:${lamp.n}`, type: 'other', name: `燈柱 ${lamp.n}`, lat: lamp.a, lng: lamp.o, address: lamp.s, source: '路政署燈柱資料' });
    } catch {
      setMessage('未能讀取已下載的燈柱資料；可重試，或改用標距柱編號。');
    }
  };

  return <section className="landmark-card landmark-selector" aria-labelledby="landmark-selector-title">
    <span className="eyebrow">KNOWN LOCATION MARKERS</span>
    <h2 id="landmark-selector-title">你附近看到什麼？</h2>
    <p>選擇現場地標，搜尋名稱或輸入編號；選取後會在 App 地圖顯示其座標。</p>
    <div className="landmark-types" role="group" aria-label="地標種類">
      {OPTIONS.map(item => <button type="button" key={item.id} className={kind === item.id ? 'active' : ''} onClick={() => { setKind(item.id); setQuery(''); setMessage(''); }}>{item.label}</button>)}
    </div>
    <div className="landmark-search">
      <input value={query} onChange={event => { setQuery(event.target.value); setMessage(''); }} onKeyDown={event => { if (event.key === 'Enter' && kind === 'lamp_post') void checkLamp(); }} placeholder={option.placeholder} aria-label={option.placeholder}/>
      {kind === 'lamp_post' && <button type="button" onClick={() => void checkLamp()}>核對</button>}
    </div>
    {kind === 'lamp_post' && <small className="landmark-helper">已下載燈柱資料：{installedLamps.length} 區。山上通常較適合核對標距柱。</small>}
    {matches.length > 0 && <div className="landmark-matches" role="list" aria-label="符合的地標">
      {matches.map(item => <button type="button" role="listitem" key={item.id} onClick={() => choose(item)}>
        <span><strong>{item.name}</strong><small>{item.detail || item.address || item.source}</small></span>
        {position && <em>{formatDistance(distanceMeters(position.lat, position.lng, item.lat, item.lng))}</em>}
      </button>)}
    </div>}
    {query && kind !== 'lamp_post' && matches.length === 0 && <p className="landmark-helper">沒有相符資料；可試柱號、山徑名稱或地點名稱。</p>}
    {selected && <div className="landmark-pending selected"><strong>目前位置參考：{selected.name}</strong><span>{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</span><div><button type="button" className="cancel" onClick={onClear}>取消地標位置</button></div></div>}
    {pending && <div className="landmark-pending"><strong>{pending.name}</strong><span>{pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}</span><div><button type="button" onClick={confirmPending}>確認我就在這裡</button><button type="button" className="cancel" onClick={()=>setPending(null)}>取消</button></div></div>}
    {message && <p className="landmark-result" role="status">{message}</p>}
    {!database && <p className="landmark-helper">地標資料正在載入；如未能載入，請稍後重試。</p>}
  </section>;
}
