import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { convertCoordinates, formatHkt, type ConvertedCoordinates } from './coordinates';
import { cachedFeeds, feedTime, refreshAll, stateLabel, type FeedResult } from './liveInfo';
import { clearFacilityUpdate, distanceMeters, facilityName, formatDistance, loadFacilities, nearestFacilities, refreshFacilities, type Facility, type FacilityDatabase, type FacilityType } from './facilities';
import LocationMap from './LocationMap';
import './styles.css';

type PositionState = { coords: ConvertedCoordinates; accuracy: number; timestamp: number; altitude: number | null; heading: number | null };

function App() {
  const [position, setPosition] = useState<PositionState | null>(null);
  const [posError, setPosError] = useState('尚未開始定位');
  const [locating, setLocating] = useState(false);
  const [feeds, setFeeds] = useState<FeedResult[]>(cachedFeeds);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'prepare'|'locate'|'nearby'|'download'>('locate');
  const [locked, setLocked] = useState<PositionState | null>(null);
  const [facilityDb, setFacilityDb] = useState<FacilityDatabase | null>(null);
  const [facilityError, setFacilityError] = useState('正在檢查內置設施資料…');
  const [facilityType, setFacilityType] = useState<'all'|FacilityType>('all');
  const [tracking, setTracking] = useState(false);
  const [storage, setStorage] = useState<{usage:number;quota:number}|null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [facilityProgress, setFacilityProgress] = useState('');
  const [facilityUpdating, setFacilityUpdating] = useState(false);
  const [landmarkQuery, setLandmarkQuery] = useState('');
  const [confirmedLandmark, setConfirmedLandmark] = useState<Facility | null>(null);
  const [landmarkMessage, setLandmarkMessage] = useState('');
  const watchId = useRef<number | null>(null);

  const acceptPosition = (p: GeolocationPosition) => {
    setPosition({ coords: convertCoordinates(p.coords.latitude, p.coords.longitude), accuracy: p.coords.accuracy, timestamp: p.timestamp, altitude: p.coords.altitude, heading: p.coords.heading });
    setPosError(''); setLocating(false);
  };
  const rejectPosition = (e: GeolocationPositionError) => { setPosError(`暫時未能取得位置：${e.message}`); setLocating(false); };
  const geoOptions: PositionOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 };
  const locate = () => {
    if (!navigator.geolocation) { setPosError('此裝置／瀏覽器不支援定位'); return; }
    setLocating(true); setPosError('正在等候衛星或裝置定位…');
    navigator.geolocation.getCurrentPosition(acceptPosition, rejectPosition, geoOptions);
  };
  const toggleTracking = () => {
    if (!navigator.geolocation) { setPosError('此裝置／瀏覽器不支援定位'); return; }
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current=null; setTracking(false); return; }
    setPosError('正在等候持續定位…');
    watchId.current=navigator.geolocation.watchPosition(acceptPosition,rejectPosition,geoOptions); setTracking(true);
  };

  const confirmLandmark = () => {
    const q=landmarkQuery.trim().toUpperCase().replace(/\s+/g,'');
    if(!q){setLandmarkMessage('請輸入完整柱號');return;}
    if(!facilityDb?.items.length){setLandmarkMessage('內置地標資料尚未建立，暫時不能核對柱號');return;}
    const candidates=facilityDb.items.filter(x=>x.type==='distance_post'||x.type==='other');
    const exact=candidates.filter(x=>[x.id.split(':').pop(),x.name].some(v=>v?.toUpperCase().replace(/\s+/g,'')===q));
    if(exact.length!==1){setConfirmedLandmark(null);setLandmarkMessage(exact.length>1?'找到多於一個相同編號，不能安全確認':'找不到完全相符的官方柱號；位置未被更改');return;}
    setConfirmedLandmark(exact[0]);
    const gap=position?distanceMeters(position.coords.latitude,position.coords.longitude,exact[0].lat,exact[0].lng):null;
    setLandmarkMessage(`已找到官方地標${gap==null?'':`；與裝置定位相距 ${formatDistance(gap)}`}。請確認眼前柱號完全相同。`);
  };
  const updateFacilities = async () => {setFacilityUpdating(true);setFacilityProgress('準備更新…');try{const db=await refreshFacilities(setFacilityProgress);setFacilityDb(db);setFacilityError('');setFacilityProgress(`更新完成：${db.items.length.toLocaleString()} 個設施點`)}catch(e){setFacilityProgress(`暫時未能更新：${e instanceof Error?e.message:'未知錯誤'}。原有資料未被更改。`)}finally{setFacilityUpdating(false)}};
  const restoreBundledFacilities = async()=>{await clearFacilityUpdate();location.reload()};
  const refresh = async () => { setRefreshing(true); setFeeds(x => x.map(f => ({...f, state: 'loading'}))); await refreshAll(r => setFeeds(x => x.map(f => f.id === r.id ? r : f))); setRefreshing(false); };
  const shown = locked || position;
  const report = useMemo(() => {
    const landmark=confirmedLandmark?`\n現場確認地標：${confirmedLandmark.name}\n地標官方座標：${confirmedLandmark.lat.toFixed(6)}, ${confirmedLandmark.lng.toFixed(6)}\n目前位置參考：以上述已確認地標的官方座標為準。`:'';
    return shown ? `需要報告位置\n位置來源：${locked ? '已鎖定裝置位置' : '裝置定位'}\nWGS84：${shown.coords.latitude.toFixed(6)}, ${shown.coords.longitude.toFixed(6)}\nHK1980：E ${Math.round(shown.coords.hkE)} N ${Math.round(shown.coords.hkN)}\n方格：${shown.coords.grid8}\n定位誤差：±${Math.round(shown.accuracy)} 米\n定位時間：${formatHkt(shown.timestamp)}${landmark}` : confirmedLandmark?`暫時未能取得裝置位置。\n現場確認地標：${confirmedLandmark.name}\n地標官方座標：${confirmedLandmark.lat.toFixed(6)}, ${confirmedLandmark.lng.toFixed(6)}\n目前位置參考：以上述已確認地標的官方座標為準。`:'暫時未能取得位置。請向接線員描述附近地標。';
  }, [shown, locked, confirmedLandmark]);
  const confirmedCoords = useMemo(() => confirmedLandmark ? convertCoordinates(confirmedLandmark.lat, confirmedLandmark.lng) : null, [confirmedLandmark]);
  const positionAge = shown ? Math.max(0, Math.round((Date.now()-shown.timestamp)/1000)) : null;
  const copyReport = async () => { try { await navigator.clipboard.writeText(report); setCopyState('已複製報位資料'); } catch { setCopyState('未能自動複製，請長按下方文字複製'); } };

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    loadFacilities().then(db => { setFacilityDb(db); setFacilityError(db.items.length ? '' : '此版本的內置設施資料尚未建立'); }).catch(e => setFacilityError(`暫時未能讀取設施資料：${e instanceof Error ? e.message : '未知錯誤'}`));
    navigator.storage?.estimate().then(x=>setStorage({usage:x.usage||0,quota:x.quota||0})).catch(()=>{});
    return () => { if(watchId.current!=null) navigator.geolocation.clearWatch(watchId.current); };
  }, []);
  const referencePoint = confirmedLandmark ? {lat:confirmedLandmark.lat,lng:confirmedLandmark.lng,label:`已確認地標 ${confirmedLandmark.name}`} : shown ? {lat:shown.coords.latitude,lng:shown.coords.longitude,label:'裝置定位'} : null;
  const mapPoint = shown ? {lat:shown.coords.latitude,lng:shown.coords.longitude,accuracy:shown.accuracy} : confirmedLandmark ? {lat:confirmedLandmark.lat,lng:confirmedLandmark.lng,accuracy:0} : null;
  const nearby = useMemo(() => referencePoint && facilityDb ? nearestFacilities(facilityDb, referencePoint.lat, referencePoint.lng, facilityType, 30) : [], [referencePoint?.lat, referencePoint?.lng, facilityDb, facilityType]);
  const quality = shown ? (shown.accuracy <= 20 ? {label:'較佳',tone:'good',note:'裝置回報的誤差範圍較小'} : shown.accuracy <= 100 ? {label:'一般',tone:'medium',note:'請在較開揚位置等待持續定位改善'} : {label:'較差',tone:'poor',note:'目前誤差很大，不宜只憑這個點報告精確位置'}) : null;

  return <div className="app">
    <header><div><span className="eyebrow">WHERE AM I · HONG KONG</span><h1>我在哪裡？</h1></div><button className="sos" onClick={() => {setCopyState('');setSosOpen(true)}}>SOS · 求助</button></header>
    <nav>{([['download','下載'],['prepare','出發前'],['locate','定位'],['nearby','附近']] as const).map(([id,label]) => <button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{label}</button>)}</nav>

    <main>
      {tab === 'locate' && <>
        <section className="hero-card">
          <div className="status-row"><span className={`dot ${position?'ok':''}`}></span>{position ? (tracking?'裝置持續定位中':'已取得裝置位置') : posError}</div>
          {shown ? <><div className="latlng">{shown.coords.latitude.toFixed(6)}<br/>{shown.coords.longitude.toFixed(6)}</div><div className="accuracy">誤差半徑 ±{Math.round(shown.accuracy)} 米 · {formatHkt(shown.timestamp)}</div>{quality&&<div className={`quality ${quality.tone}`}><strong>定位品質：{quality.label}</strong><span>{quality.note}</span></div>}</> : <div className="empty">按下定位，讓裝置取得你目前的位置。GNSS 可在沒有流動數據時運作。</div>}
          <div className="locate-actions"><button className="primary" disabled={locating} onClick={locate}>{locating?'定位中…':'找出我在哪裡'}</button><button className="secondary-dark" onClick={toggleTracking}>{tracking?'停止持續定位':'持續定位'}</button></div>
        </section>
        {mapPoint && <><LocationMap lat={mapPoint.lat} lng={mapPoint.lng} accuracy={mapPoint.accuracy} locked={!!locked} devicePosition={!!shown} landmark={shown?confirmedLandmark:null} facilities={nearby}/><p className="map-note">網上底圖：香港地政總署。此畫面未標示為離線可用；只有已完成下載及驗證的地區底圖才可離線使用。</p></>}
        {shown && <section className="grid cards">
          <article><label>香港 1980 方格</label><strong>E {Math.round(shown.coords.hkE)}</strong><strong>N {Math.round(shown.coords.hkN)}</strong></article>
          <article><label>香港地圖方格 · 8 位</label><strong>{shown.coords.grid8}</strong><small>6 位：{shown.coords.grid6}</small></article>
          <article><label>UTM</label><strong>{shown.coords.zone}Q</strong><small>E {Math.round(shown.coords.utmE)} · N {Math.round(shown.coords.utmN)}</small></article>
          <article><label>位置紀錄</label><strong>{locked?'已鎖定':'即時位置'}</strong><small>{shown.altitude == null ? '裝置未提供高度' : `高度 ${Math.round(shown.altitude)} 米`}</small></article>
        </section>}
        {shown && <div className="actions"><button onClick={()=>setLocked(locked?null:position)}>{locked?'解除位置鎖定':'鎖定這個位置'}</button><button onClick={copyReport}>複製報位資料</button><button onClick={()=>navigator.share?.({title:'我的位置',text:report}).catch(()=>{})}>分享</button></div>}
        <section className="landmark-card"><span className="eyebrow">KNOWN LANDMARK</span><h2>用眼前柱號核實位置</h2><p>輸入完整標距柱編號；日後下載所屬地區燈柱資料後亦可查燈柱。系統只接受完全相符的唯一結果。</p><div className="landmark-search"><input value={landmarkQuery} onChange={e=>setLandmarkQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')confirmLandmark()}} placeholder="例如 M047"/><button onClick={confirmLandmark}>核對</button></div>{landmarkMessage&&<p className={confirmedLandmark?'landmark-ok':'landmark-error'}>{landmarkMessage}</p>}{confirmedLandmark&&confirmedCoords&&<div className="confirmed-landmark"><strong>現在位置參考：{confirmedLandmark.name}</strong><span>WGS84　{confirmedLandmark.lat.toFixed(6)}, {confirmedLandmark.lng.toFixed(6)}</span><span>HK1980　E {Math.round(confirmedCoords.hkE)}　N {Math.round(confirmedCoords.hkN)}</span><span>方格　{confirmedCoords.grid8}</span><small>地圖紅點為已確認地標位置；藍點及誤差圈為裝置定位。附近設施將以地標座標作位置參考。</small><button onClick={()=>{setConfirmedLandmark(null);setLandmarkMessage('')}}>取消確認</button></div>}</section>
      </>}

      {tab === 'prepare' && <section><div className="section-head"><div><span className="eyebrow">LIVE SAFETY DATA</span><h2>出發前即時資訊</h2></div><button className="primary compact" disabled={refreshing} onClick={refresh}>{refreshing?'更新中…':'一鍵刷新'}</button></div><p className="warning">成功刷新後顯示官方「目前發布」的完整快照，不會混入上次已移除的舊消息。未能更新不代表沒有警告；此時只會明確標示並保留整份舊快照供參考。</p><div className="feed-list">{feeds.map(f=><article key={f.id} className={`feed ${f.state}`}><div><span className="source">{f.source}</span><h3>{f.name}</h3><p>{f.message}</p><small>{f.state==='fresh'?'目前快照抓取時間':'過往快取抓取時間'}：{feedTime(f)}</small>{f.items&&f.items.length>0&&<details className={`feed-details ${f.state==='cached'?'past':''}`}><summary>{f.state==='cached'?`過往消息快取（${f.items.length} 項，非目前狀態）`:`查看目前 ${f.items.length} 項資料`}</summary>{f.state==='cached'&&<p className="past-warning">這是上一次成功抓取的過往快照，只在暫時收不到目前資料時保留參考。</p>}{f.items.map((item,i)=><div className="feed-item" key={i}><strong>{item.title}</strong>{item.detail&&<p>{item.detail}</p>}{item.publishedAt?<small>官方時間：{item.publishedAt}</small>:<small>官方沒有提供可辨識時間，依官方原有次序顯示</small>}</div>)}</details>}</div><span className="badge">{stateLabel(f)}</span></article>)}</div></section>}

      {tab === 'download' && <section><span className="eyebrow">OFFLINE CONTENT</span><h2>離線資料</h2>{storage&&<div className="storage"><span>此網站已用空間</span><strong>{(storage.usage/1048576).toFixed(1)} MB</strong><small>瀏覽器可用配額約 {(storage.quota/1073741824).toFixed(1)} GB；實際可用量由裝置決定</small></div>}<div className="download-card ready"><div><h3>全港基本設施</h3><p>公廁、AED、加水站、消防局、救護站及標距柱可從官方來源更新並保存於本機；正式內置資料仍由已驗證建置流程產生。</p><div className="download-actions"><button disabled={facilityUpdating} onClick={updateFacilities}>{facilityUpdating?'更新中…':'更新官方設施資料'}</button>{facilityDb?.generatedAt&&<button onClick={restoreBundledFacilities}>還原內置版本</button>}</div>{facilityProgress&&<small>{facilityProgress}</small>}</div><span>{facilityDb?.items.length ? `${facilityDb.items.length.toLocaleString()} 項 · ${facilityDb.version}` : '尚未建立'}</span></div><div className="download-card"><div><h3>地區底圖</h3><p>按地區預先下載；下載及完整性驗證模組尚未接駁 HKMAP 圖源。</p></div><span>未下載</span></div><div className="download-card"><div><h3>地區燈柱</h3><p>大型點資料按區下載，不影響基本定位。</p></div><span>未下載</span></div>{facilityError && <p className="honesty">{facilityError}，故不會假裝顯示已可離線搜尋附近設施。</p>}</section>}

      {tab === 'nearby' && <section><span className="eyebrow">NEARBY</span><h2>附近資訊</h2>{!referencePoint ? <div className="empty">先到「定位」取得目前位置，才能計算附近設施。</div> : facilityError ? <div className="empty">{facilityError}，因此暫時未能列出附近設施。這不代表附近沒有 AED、公廁或救援服務。</div> : <><div className="filters">{(['all','toilet','aed','water','fire_station','ambulance_station','distance_post'] as const).map(t=><button className={facilityType===t?'active':''} key={t} onClick={()=>setFacilityType(t)}>{t==='all'?'全部':facilityName[t]}</button>)}</div><p className="near-note">位置基準：{referencePoint?.label}。以下為直線距離，不代表實際可步行距離。資料版本：{facilityDb?.version}</p><div className="near-list">{nearby.map(x=><article key={x.id}><div><span className="source">{facilityName[x.type]} · {x.source}</span><h3>{x.name}</h3>{x.address&&<p>{x.address}</p>}{x.hours&&<small>開放時間：{x.hours}</small>}</div><div className="distance"><strong>{formatDistance(x.distance)}</strong><span>{x.direction} · {Math.round(x.bearing)}°</span></div></article>)}</div></>}</section>}
    </main>
    <footer>安全資訊只供輔助 · 遇到即時危險請致電 999／112</footer>
    {sosOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSosOpen(false)}}><section className="sos-panel" role="dialog" aria-modal="true" aria-labelledby="sos-title"><button className="modal-close" onClick={()=>setSosOpen(false)} aria-label="關閉">×</button><span className="eyebrow red">EMERGENCY</span><h2 id="sos-title">緊急求助</h2>{!shown?<p className="danger-message">目前沒有位置資料。致電時請描述附近地標、建築物、燈柱或標距柱編號。</p>:<><div className={`position-health ${positionAge!==null&&positionAge>300?'stale':''}`}><strong>{locked?'已鎖定裝置位置':'裝置定位位置'}</strong><span>誤差 ±{Math.round(shown.accuracy)} 米 · {(positionAge??0)<60?`${positionAge} 秒前`:`${Math.floor((positionAge??0)/60)} 分鐘前`}</span></div>{positionAge!==null&&positionAge>300&&<p className="danger-message">此位置已超過 5 分鐘，可能不是目前位置。請重新定位或向接線員說明。</p>}{shown.accuracy>100&&<p className="danger-message">裝置回報誤差超過 100 米。請同時向接線員提供附近地標、燈柱或標距柱編號。</p>}</>}<pre className="report">{report}</pre>{copyState&&<p className="copy-state">{copyState}</p>}<div className="emergency-actions"><a className="call" href="tel:999">致電 999</a><a className="call secondary-call" href="tel:112">致電 112</a><button onClick={copyReport}>複製報位</button><button onClick={()=>navigator.share?.({title:'緊急報位資料',text:report}).catch(()=>{})}>分享報位</button></div><p className="sos-note">112 會嘗試透過可用流動網絡接駁緊急服務；能否接通視乎現場網絡。App 不會自動替你致電。</p></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
