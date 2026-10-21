import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { convertCoordinates, formatHkt, type ConvertedCoordinates } from './coordinates';
import { cachedFeeds, feedTime, refreshAll, stateLabel, type FeedResult } from './liveInfo';
import { clearFacilityUpdate, distanceMeters, facilityName, formatDistance, hasFacilityOverride, loadFacilities, nearestFacilities, refreshFacilities, type Facility, type FacilityDatabase, type FacilityType } from './facilities';
// Lazy-loaded: leaflet (~350kB) is only fetched once the user actually opens a map tab,
// instead of bloating the initial JS payload for everyone. FACILITY_COLORS/ALERT_COLOR live
// in the dependency-free ./mapStyles so the legend can render before the map chunk arrives.
const LocationMap = lazy(() => import('./LocationMap'));
import { FACILITY_COLORS, ALERT_COLOR } from './mapStyles';
import TerrainCamera from './TerrainCamera';
import LandmarkSelector from './LandmarkSelector';
import { downloadLampDistrict, installedLampDistricts, loadLampManifest, removeLampDistrict, type LampManifest } from './lampposts';
import { downloadRegion, MAP_REGIONS, mapInstalls, regionUrls, removeRegion, verifyRegion, checkRegionUpdate, type MapInstall } from './offlineMaps';
import { removeTerrainRegion, terrainInstalls, verifyTerrainRegion, type TerrainInstall } from './terrainData';
import { dtmInstalls, importDtmFile, removeDtmRegion, verifyDtmRegion, type DtmInstall } from './dtmData';
import type { TerrainCandidate } from './terrainMatcher';
import './styles.css';

type PositionState = { coords: ConvertedCoordinates; accuracy: number; timestamp: number; altitude: number | null; heading: number | null };

function App() {
  const [position, setPosition] = useState<PositionState | null>(null);
  const [posError, setPosError] = useState('尚未開始定位');
  const [locating, setLocating] = useState(false);
  const [feeds, setFeeds] = useState<FeedResult[]>(cachedFeeds);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'prepare'|'locate'|'nearby'|'download'|'sources'>('locate');
  const [locked, setLocked] = useState<PositionState | null>(null);
  const [facilityDb, setFacilityDb] = useState<FacilityDatabase | null>(null);
  const [facilityError, setFacilityError] = useState('');
  const [facilityLoading, setFacilityLoading] = useState(true);
  const [facilityOverridden, setFacilityOverridden] = useState(false);
  const [facilityType, setFacilityType] = useState<'all'|FacilityType>('all');
  const [tracking, setTracking] = useState(false);
  const [storage, setStorage] = useState<{usage:number;quota:number}|null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean|null>(null);
  const [readiness, setReadiness] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [geoPermission, setGeoPermission] = useState<PermissionState|'unsupported'>('unsupported');
  const [sosOpen, setSosOpen] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [facilityProgress, setFacilityProgress] = useState('');
  const [facilityUpdating, setFacilityUpdating] = useState(false);
  const [lampManifest, setLampManifest] = useState<LampManifest|null>(null);
  const [installedLamps, setInstalledLamps] = useState<string[]>([]);
  const [lampProgress, setLampProgress] = useState('');
  const [lampBusy, setLampBusy] = useState<string|null>(null);
  const [maps, setMaps] = useState<MapInstall[]>(mapInstalls);
  const [mapProgress, setMapProgress] = useState('');
  const [terrainMaps, setTerrainMaps] = useState<TerrainInstall[]>([]);
  const [dtmMaps, setDtmMaps] = useState<DtmInstall[]>([]);
  const [dtmProgress, setDtmProgress] = useState('');
  const [dtmBusy, setDtmBusy] = useState<string|null>(null);
  const [terrainCandidate, setTerrainCandidate] = useState<TerrainCandidate|null>(null);
  const [mapDownloading, setMapDownloading] = useState<string|null>(null);
  const [mapChecking, setMapChecking] = useState<string|null>(null);
  const [mapUpdateStatus, setMapUpdateStatus] = useState<Record<string,string>>({});
  const mapAbort = useRef<AbortController|null>(null);
  const [confirmedLandmark, setConfirmedLandmark] = useState<Facility | null>(null);
  const watchId = useRef<number | null>(null);

  const acceptPosition = (p: GeolocationPosition) => {
    setPosition({ coords: convertCoordinates(p.coords.latitude, p.coords.longitude), accuracy: p.coords.accuracy, timestamp: p.timestamp, altitude: p.coords.altitude, heading: p.coords.heading });
    setPosError(''); setLocating(false);
  };
  // GeolocationPositionError.message is browser/OS-defined English text (e.g. "User denied
  // Geolocation", "Network location provider at ... failed") shown as-is to a Chinese-reading
  // user relying on this app in an emergency. Translate the three standard error codes; keep the
  // raw message only as a fallback for genuinely unknown codes so nothing is silently hidden.
  const geoErrorMessage = (e: GeolocationPositionError) => {
    if (e.code === e.PERMISSION_DENIED) return '定位權限被拒絕，請到瀏覽器或系統設定開啟位置存取後重試';
    if (e.code === e.POSITION_UNAVAILABLE) return '裝置暫時未能判斷位置，請移到較開揚地方再試';
    if (e.code === e.TIMEOUT) return '定位逾時，衛星或網絡訊號可能暫時太弱，請重試';
    return e.message || '未知定位錯誤';
  };
  const rejectPosition = (e: GeolocationPositionError) => { setPosError(`暫時未能取得位置：${geoErrorMessage(e)}`); setLocating(false); };
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

  const updateFacilities = async () => {setFacilityUpdating(true);setFacilityProgress('準備更新…');try{const db=await refreshFacilities(setFacilityProgress);setFacilityDb(db);setFacilityError('');setFacilityOverridden(true);setFacilityProgress(`更新完成：${db.items.length.toLocaleString()} 個設施點`)}catch(e){setFacilityProgress(`暫時未能更新：${e instanceof Error?e.message:'未知錯誤'}。原有資料未被更改。`)}finally{setFacilityUpdating(false)}};
  // clearFacilityUpdate() opens IndexedDB, which can throw in the same restrictive contexts noted
  // above. Previously an unhandled rejection here meant the button did nothing at all -- no reload,
  // no error, no way to tell the tap even registered.
  const restoreBundledFacilities = async()=>{try{await clearFacilityUpdate();location.reload()}catch(e){setFacilityProgress(`未能還原內置版本：${e instanceof Error?e.message:'未知錯誤'}`)}};
  const requestPersistentStorage=async()=>{if(!navigator.storage?.persist){setReadiness('此瀏覽器不支援防止自動清理儲存資料');return}try{const ok=await navigator.storage.persist();setStoragePersistent(ok);setReadiness(ok?'瀏覽器已允許保留離線資料':'瀏覽器未允許永久保留；長期不用App時資料仍可能被自動清理')}catch(e){setReadiness(`未能查詢或設定儲存保留：${e instanceof Error?e.message:'未知錯誤'}`)}};
  const [offlineChecking,setOfflineChecking]=useState(false);
  const runOfflineCheck=async()=>{
    setOfflineChecking(true);setReadiness('正在逐一檢查已下載地圖…');
    try{
      const installed=mapInstalls();
      if(!installed.length)setReadiness('未下載離線底圖；繼續檢查 DTM、等高線及其他資料…');
      for(const item of installed){const region=MAP_REGIONS.find(r=>r.id===item.id);if(!region)continue;const result=await verifyRegion(region,(done,total)=>setReadiness(`檢查${region.name}底圖：${done}／${total}`));if(!result.complete){setReadiness(`${region.name}底圖缺少${result.missing}個圖磚，不能視為完整離線地圖`);return}}
      const installedTerrain=await terrainInstalls();
      for(const item of installedTerrain){const result=await verifyTerrainRegion(item.id);if(!result.complete){setReadiness(`${item.name}20米等高線資料不完整（缺${result.missingPages}頁），請重試下載`);return}}
      const installedDtm=await dtmInstalls();
      for(const item of installedDtm){const result=await verifyDtmRegion(item.id);if(!result.complete){setReadiness(`${item.name}5米 DTM 格網不完整，請重新匯入`);return}}
      setReadiness(`離線檢查完成：${installed.length}區底圖完整、${installedDtm.length}區5米 DTM完整、${installedTerrain.length}區備援等高線完整；設施資料${facilityDb?.items.length?'可讀取':'尚未建立'}；燈柱已下載${installedLamps.length}區`)
    }catch(e){
      // caches.open()/match() can throw in restrictive contexts (e.g. Cache Storage disabled in
      // some private-browsing modes). Previously this left "正在逐一檢查…" on screen forever with
      // no indication the check had actually failed rather than still being in progress.
      setReadiness(`未能完成離線檢查：${e instanceof Error?e.message:'未知錯誤'}`)
    }finally{setOfflineChecking(false)}
  };
  const importDtm = async (region:typeof MAP_REGIONS[number], file:File) => {
    setDtmBusy(region.id); setDtmProgress(`準備匯入${region.name}的官方5米 DTM…`);
    try {
      const install=await importDtmFile(file,region,setDtmProgress);
      setDtmMaps(await dtmInstalls());
      setDtmProgress(`${install.name}5米 DTM 已匯入並離線保存（${install.width.toLocaleString()}×${install.height.toLocaleString()}格）`);
      navigator.storage?.estimate().then(result=>setStorage({usage:result.usage||0,quota:result.quota||0})).catch(()=>{});
    } catch(error) {
      setDtmProgress(`DTM 匯入失敗：${error instanceof Error?error.message:'未知錯誤'}。原有資料未被更改。`);
    } finally { setDtmBusy(null); }
  };
  const installMap = async (region:typeof MAP_REGIONS[number]) => {
    const ctrl = new AbortController();
    mapAbort.current = ctrl;
    setMapDownloading(region.id);
    setMapProgress(`準備下載${region.name}底圖…`);
    try {
      await downloadRegion(region, (done,total) => setMapProgress(`${region.name}底圖：${done.toLocaleString()}／${total.toLocaleString()} 圖磚（${Math.round(done/total*100)}%）`), ctrl.signal);
      setMaps(mapInstalls());
      setMapProgress(`${region.name}離線底圖已完成；鏡頭比對另需匯入官方5米 DTM`);
    } catch(e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      setMapProgress(cancelled ? '下載已取消；已完成的底圖圖磚會保留，重試可續傳' : `下載中斷：${e instanceof Error?e.message:'未知錯誤'}。已完成資料會保留，重試可續傳。`);
      setMaps(mapInstalls());
      setTerrainMaps(await terrainInstalls().catch(() => terrainMaps));
    } finally {
      setMapDownloading(null);
      mapAbort.current = null;
    }
  };
  const removeOfflineRegion = async (region:typeof MAP_REGIONS[number]) => {
    try {
      await removeRegion(region.id);
      await removeTerrainRegion(region.id);
      setMaps(mapInstalls());
      setTerrainMaps(await terrainInstalls());
      setMapProgress(`${region.name}底圖及舊版20米等高線已刪除；5米 DTM需在上方另行管理`);
      } catch(e) {
      setMapProgress(`未能完整刪除${region.name}資料：${e instanceof Error?e.message:'未知錯誤'}`);
    }
  };
  const checkMapUpdate = async (region:typeof MAP_REGIONS[number]) => { setMapChecking(region.id); setMapUpdateStatus(x=>({...x,[region.id]:'正在向官方檢查圖磚版本…'})); try { const result=await checkRegionUpdate(region); setMapUpdateStatus(x=>({...x,[region.id]:result.updated?'發現可能有新版，請重新下載':'暫未發現新版（只檢查代表性圖磚）'})); } catch { setMapUpdateStatus(x=>({...x,[region.id]:'暫時未能檢查官方版本'})); } finally { setMapChecking(null); } };
  const refresh = async () => { setRefreshing(true); setFeeds(x => x.map(f => ({...f, state: 'loading'}))); await refreshAll(r => setFeeds(x => x.map(f => f.id === r.id ? r : f))); setRefreshing(false); };
  const shown = locked || position;
  // Copy/share feedback ("已複製報位資料" etc.) is meaningful only right after the action that
  // produced it — clear it on tab switches and when the SOS modal closes so stale confirmation
  // text from a previous screen never lingers and gets mistaken for feedback on a new action.
  useEffect(() => { setCopyState(''); }, [tab, sosOpen]);
  const referencePoint = confirmedLandmark ? {lat:confirmedLandmark.lat,lng:confirmedLandmark.lng,label:`已確認地標 ${confirmedLandmark.name}`} : shown ? {lat:shown.coords.latitude,lng:shown.coords.longitude,label:'裝置定位'} : null;
  // Always computed across ALL facility types (never filtered by the "附近" tab's type chips) so the
  // "定位" tab map/legend and the SOS report's rescuer hint stay stable no matter what a user last
  // filtered by on the nearby list — a filter chosen to browse toilets should not silently hide every
  // other marker on the location map.
  const mapFacilities = useMemo(() => referencePoint && facilityDb ? nearestFacilities(facilityDb, referencePoint.lat, referencePoint.lng, 'all', 30) : [], [referencePoint?.lat, referencePoint?.lng, facilityDb]);
  // The nearest known, officially-numbered distance post — surfaced to whoever reads the SOS report
  // (999/112 operator, rescue team) even when the user hasn't manually confirmed it themselves, so
  // there is always a second, physically-findable reference point alongside raw coordinates.
  const nearestKnownPost = useMemo(() => {
    const post = mapFacilities.find(x=>x.type==='distance_post');
    if(!post || post.distance>500) return null;
    if(confirmedLandmark && confirmedLandmark.id===post.id) return null;
    return post;
  }, [mapFacilities, confirmedLandmark]);
  const report = useMemo(() => {
    const landmark=confirmedLandmark?`\n現場確認地標：${confirmedLandmark.name}\n地標官方座標：${confirmedLandmark.lat.toFixed(6)}, ${confirmedLandmark.lng.toFixed(6)}\n目前位置參考：以上述已確認地標的官方座標為準。`:'';
    const hint=nearestKnownPost?`\n附近已知標距柱（系統計算，尚未現場確認）：${nearestKnownPost.name}，距離約 ${formatDistance(nearestKnownPost.distance)}，方位 ${nearestKnownPost.direction} ${Math.round(nearestKnownPost.bearing)}°`:'';
    const terrain=terrainCandidate?`\n試驗性山形比對候選（不是 GPS，尚未現場確認）：${terrainCandidate.lat.toFixed(5)}, ${terrainCandidate.lng.toFixed(5)}\n粗略不確定度：約 ±${Math.round(terrainCandidate.uncertaintyMetres)} 米（未校準）；山形差 ${terrainCandidate.scoreDegrees.toFixed(2)}°；區域：${terrainCandidate.region}；比對時間：${formatHkt(terrainCandidate.calculatedAt)}\n安全提示：此候選由5米 DTM 及相機輪廓推算，模型未經校準，可能錯誤，未經驗證，請勿單獨依賴作求救位置。`:'';
    return shown ? `需要報告位置\n位置來源：${locked ? '已鎖定裝置位置' : '裝置定位'}\nWGS84：${shown.coords.latitude.toFixed(6)}, ${shown.coords.longitude.toFixed(6)}\nHK1980：E ${Math.round(shown.coords.hkE)} N ${Math.round(shown.coords.hkN)}\n方格：${shown.coords.grid8}\n定位誤差：±${Math.round(shown.accuracy)} 米\n定位時間：${formatHkt(shown.timestamp)}${landmark}${hint}${terrain}` : confirmedLandmark?`暫時未能取得裝置位置。\n現場確認地標：${confirmedLandmark.name}\n地標官方座標：${confirmedLandmark.lat.toFixed(6)}, ${confirmedLandmark.lng.toFixed(6)}\n目前位置參考：以上述已確認地標的官方座標為準。${hint}${terrain}`:`暫時未能取得裝置位置。請向接線員描述附近地標。${terrain}${hint}`;
  }, [shown, locked, confirmedLandmark, nearestKnownPost, terrainCandidate]);
  const confirmedCoords = useMemo(() => confirmedLandmark ? convertCoordinates(confirmedLandmark.lat, confirmedLandmark.lng) : null, [confirmedLandmark]);
  const positionAge = shown ? Math.max(0, Math.round((Date.now()-shown.timestamp)/1000)) : null;
  const copyReport = async () => { try { await navigator.clipboard.writeText(report); setCopyState('已複製報位資料'); } catch { setCopyState('未能自動複製，請長按下方文字複製'); } };
  // navigator.share is silently absent on many desktop browsers and some devices — a button that
  // does nothing when pressed is a real trap in an emergency flow. Always fall back to clipboard
  // copy (with visible feedback) instead of failing silently.
  const shareOrCopy = async (text: string, title: string) => {
    const canShare = 'share' in navigator;
    if (canShare) {
      try { await navigator.share({ title, text }); return; } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); setCopyState(canShare ? '分享未能完成，已改為複製到剪貼簿' : '此裝置不支援分享，已複製到剪貼簿'); }
    catch { setCopyState('未能分享或複製，請長按下方文字手動複製'); }
  };

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    loadFacilities().then(db => { setFacilityDb(db); setFacilityError(db.items.length ? '' : '此版本的內置設施資料尚未建立'); }).catch(e => setFacilityError(`暫時未能讀取設施資料：${e instanceof Error ? e.message : '未知錯誤'}`)).finally(() => setFacilityLoading(false));
    hasFacilityOverride().then(setFacilityOverridden).catch(() => {});
    navigator.storage?.estimate().then(x=>setStorage({usage:x.usage||0,quota:x.quota||0})).catch(()=>{});
    navigator.storage?.persisted?.().then(setStoragePersistent).catch(()=>{});
    loadLampManifest().then(setLampManifest).catch(()=>{});installedLampDistricts().then(setInstalledLamps).catch(()=>{});terrainInstalls().then(setTerrainMaps).catch(()=>{});dtmInstalls().then(setDtmMaps).catch(()=>{});
    const onOnline=()=>setOnline(true),onOffline=()=>setOnline(false);window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);
    navigator.permissions?.query({name:'geolocation'}).then(p=>{setGeoPermission(p.state);p.onchange=()=>setGeoPermission(p.state)}).catch(()=>setGeoPermission('unsupported'));
    return () => { if(watchId.current!=null) navigator.geolocation.clearWatch(watchId.current);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline); };
  }, []);
  const mapPoint = shown ? {lat:shown.coords.latitude,lng:shown.coords.longitude,accuracy:shown.accuracy} : confirmedLandmark ? {lat:confirmedLandmark.lat,lng:confirmedLandmark.lng,accuracy:0} : null;
  // Filtered by the "附近" tab's type chips — intentionally independent from mapFacilities above.
  const nearby = useMemo(() => referencePoint && facilityDb ? nearestFacilities(facilityDb, referencePoint.lat, referencePoint.lng, facilityType, 30) : [], [referencePoint?.lat, referencePoint?.lng, facilityDb, facilityType]);
  // HK hikers navigate by matching official distance-post codes to the ground, not raw coordinates.
  // Surface the closest few directly on the "定位" tab (not buried a tab away) so someone lost can
  // immediately see "walk toward M047, 82m 東北" without extra taps.
  const nearestPosts = useMemo(() => mapFacilities.filter(x => x.type === 'distance_post').slice(0, 3), [mapFacilities]);
  const mapsAppLink = (lat: number, lng: number, label: string) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${encodeURIComponent(label)})`;
  const mapAlerts = useMemo(() => [...(feeds.find(f=>f.id==='trails')?.items||[]), ...(feeds.find(f=>f.id==='facilities')?.items||[])], [feeds]);
  const mapLegend = useMemo(() => { const types=[...new Set(mapFacilities.slice(0,50).map(x=>x.type))]; return types.map(t=>({label:facilityName[t],color:FACILITY_COLORS[t]||FACILITY_COLORS.other})); }, [mapFacilities]);
  const offlineCoverage=shown?MAP_REGIONS.filter(r=>shown.coords.latitude>=r.bounds[0]&&shown.coords.latitude<=r.bounds[2]&&shown.coords.longitude>=r.bounds[1]&&shown.coords.longitude<=r.bounds[3]).map(r=>({name:r.name,ready:maps.some(x=>x.id===r.id&&x.complete)})):[];
  const terrainCoverage=shown?MAP_REGIONS.filter(r=>shown.coords.latitude>=r.bounds[0]&&shown.coords.latitude<=r.bounds[2]&&shown.coords.longitude>=r.bounds[1]&&shown.coords.longitude<=r.bounds[3]).map(r=>({name:r.name,ready:terrainMaps.some(x=>x.id===r.id&&x.complete)})):[];
  const dtmCoverage=shown?MAP_REGIONS.filter(r=>shown.coords.latitude>=r.bounds[0]&&shown.coords.latitude<=r.bounds[2]&&shown.coords.longitude>=r.bounds[1]&&shown.coords.longitude<=r.bounds[3]).map(r=>({name:r.name,ready:dtmMaps.some(x=>x.id===r.id&&x.complete)})):[];
  const quality = shown ? (shown.accuracy <= 20 ? {label:'較佳',tone:'good',note:'誤差細，準'} : shown.accuracy <= 100 ? {label:'一般',tone:'medium',note:'去開揚啲嘅地方等下會準啲'} : {label:'較差',tone:'poor',note:'誤差好大，唔好淨係靠呢個位'}) : null;
  const weatherNowFeed = feeds.find(f => f.id === 'weather-now');
  const weatherWarnFeed = feeds.find(f => f.id === 'weather');
  const trailsFeed = feeds.find(f => f.id === 'trails');
  const facilitiesFeed = feeds.find(f => f.id === 'facilities');
  const trafficFeed = feeds.find(f => f.id === 'traffic');

  const activeWarnings = useMemo(() => {
    return (weatherWarnFeed?.items || []).filter(i => !i.detail?.includes('已取消') && i.statusBadge !== '已取消');
  }, [weatherWarnFeed]);

  const closedTrails = useMemo(() => {
    return trailsFeed?.items || [];
  }, [trailsFeed]);

  const closedFacilities = useMemo(() => {
    return facilitiesFeed?.items || [];
  }, [facilitiesFeed]);

  const trafficIncidents = useMemo(() => {
    return trafficFeed?.items || [];
  }, [trafficFeed]);

  const preflight=[
    {label:'目前網絡',ok:online,detail:online?'已連線，可刷新即時資料':'裝置離線；即時資料不能更新'},
    {label:'定位權限',ok:geoPermission==='granted'||!!shown,detail:geoPermission==='denied'?'已拒絕，請到系統設定開啟':geoPermission==='prompt'?'尚未授權，請先按定位':geoPermission==='unsupported'?'瀏覽器未能查詢權限狀態':'已允許'},
    {label:'目前位置',ok:!!shown,detail:shown?`誤差 ±${Math.round(shown.accuracy)} 米，${formatHkt(shown.timestamp)}`:'尚未取得裝置位置'},
    {label:'離線底圖',ok:offlineCoverage.some(x=>x.ready),detail:shown?(offlineCoverage.some(x=>x.ready)?offlineCoverage.filter(x=>x.ready).map(x=>x.name).join('、'):'目前位置沒有完整離線底圖'):(maps.length?`已下載${maps.length}區；取得位置後再核對覆蓋`:'尚未下載')},
    {label:'離線5米 DTM',ok:dtmCoverage.some(x=>x.ready),detail:shown?(dtmCoverage.some(x=>x.ready)?dtmCoverage.filter(x=>x.ready).map(x=>x.name).join('、'):'此區尚未匯入5米 DTM'):(dtmMaps.length?`已匯入${dtmMaps.length}區`:'尚未匯入')},
    {label:'備援20米等高線',ok:terrainCoverage.some(x=>x.ready),detail:shown?(terrainCoverage.some(x=>x.ready)?terrainCoverage.filter(x=>x.ready).map(x=>x.name).join('、'):'此區尚未下載備援等高線'):(terrainMaps.length?`已下載${terrainMaps.length}區`:'尚未下載')},
    {label:'基本設施',ok:!!facilityDb?.items.length,detail:facilityDb?.items.length?`${facilityDb.items.length.toLocaleString()}項，版本${facilityDb.version}`:'尚未建立或下載'},
    {label:'燈柱資料',ok:installedLamps.length>0,detail:installedLamps.length?`已下載${installedLamps.length}區`:'未下載；標距柱仍可使用'},
    {label:'儲存保留',ok:storagePersistent===true,detail:storagePersistent?'瀏覽器已允許保留':'未獲保證，資料可能被自動清理'},
  ];

  return <div className="app">
    <header><div><span className="eyebrow">WHERE AM I · HONG KONG</span><h1>我在哪裡？</h1></div><div className="header-actions"><button className="sos" onClick={() => {setCopyState('');setSosOpen(true)}}>🆘 求救</button></div></header>
    <nav>{([['download','📥 下載'],['prepare','✅ 出發前'],['locate','📍 定位'],['nearby','🧭 附近'],['sources','📄 來源']] as const).map(([id,label]) => <button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{label}</button>)}</nav>

    <main>
      {tab === 'locate' && <>
        <section className="hero-card">
          <div className="status-row"><span className={`dot ${position?'ok':''}`}></span>{position ? (tracking?'裝置持續定位中':'已取得裝置位置') : posError}</div>
          {tracking && position && posError && <p className="danger-message tracking-warning">📡 訊號中斷，而家顯示緊上次位置（{formatHkt(position.timestamp)}）</p>}
          {shown ? <><div className="latlng">{shown.coords.latitude.toFixed(6)}<br/>{shown.coords.longitude.toFixed(6)}</div><div className="accuracy">誤差半徑 ±{Math.round(shown.accuracy)} 米 · {formatHkt(shown.timestamp)}</div>{quality&&<div className={`quality ${quality.tone}`}><strong>定位品質：{quality.label}</strong><span>{quality.note}</span></div>}</> : <div className="empty">撳下面粒掣，搵你而家喺邊。冇數據都得。</div>}
          <div className="locate-actions"><button className="primary" disabled={locating} onClick={locate}>{locating?'定位中…':'找出我在哪裡'}</button><button className="secondary-dark" onClick={toggleTracking}>{tracking?'停止持續定位':'持續定位'}</button></div>
        </section>
        <TerrainCamera dtmRegions={dtmMaps} onBestCandidate={setTerrainCandidate}/>
        {mapPoint && <><Suspense fallback={<div className="location-map location-map-loading" aria-label="地圖載入中">地圖載入中…</div>}><LocationMap lat={mapPoint.lat} lng={mapPoint.lng} accuracy={mapPoint.accuracy} locked={!!locked} devicePosition={!!shown} landmark={shown?confirmedLandmark:null} facilities={mapFacilities} alerts={mapAlerts}/></Suspense>{(mapLegend.length>0||mapAlerts.length>0)&&<div className="map-legend"><span><i style={{background:mapPoint&&shown?(locked?'#e9a23b':'#2078d4'):'#c53d35'}}/>{shown?(locked?'已鎖定裝置位置':'裝置定位'):'已確認地標'}</span>{mapLegend.map(x=><span key={x.label}><i style={{background:x.color}}/>{x.label}</span>)}{mapAlerts.length>0&&<span><i style={{background:ALERT_COLOR}}/>封閉山徑／設施</span>}</div>}<p className="map-note">每個點都有編號，撳一下睇詳情</p>{shown&&<p className={`offline-coverage ${offlineCoverage.some(x=>x.ready)?'ready':'missing'}`}>{offlineCoverage.some(x=>x.ready)?`✓ 呢度有離線地圖：${offlineCoverage.filter(x=>x.ready).map(x=>x.name).join('、')}`:'⚠️ 呢度未有離線地圖，冇網絡會見到空白'}</p>}</>}
        {shown && <section className="grid cards">
          <article><label>香港 1980 方格</label><strong>E {Math.round(shown.coords.hkE)}</strong><strong>N {Math.round(shown.coords.hkN)}</strong></article>
          <article><label>香港地圖方格 · 8 位</label><strong>{shown.coords.grid8}</strong><small>6 位：{shown.coords.grid6}</small></article>
          <article><label>UTM</label><strong>{shown.coords.zone}Q</strong><small>E {Math.round(shown.coords.utmE)} · N {Math.round(shown.coords.utmN)}</small></article>
          <article><label>位置紀錄</label><strong>{locked?'已鎖定':'即時位置'}</strong><small>{shown.altitude == null ? '裝置未提供高度' : `高度 ${Math.round(shown.altitude)} 米`}</small></article>
        </section>}
        {shown && <><div className="actions"><button onClick={()=>setLocked(locked?null:position)}>{locked?'解除位置鎖定':'鎖定這個位置'}</button><button onClick={copyReport}>複製報位資料</button><button onClick={()=>shareOrCopy(report,'我的位置')}>分享</button></div>{copyState&&<p className="copy-state">{copyState}</p>}</>}
        {nearestPosts.length>0 && <section className="landmark-card wayfinding-card"><span className="eyebrow">WAYFINDING</span><h2>附近標距柱</h2><p>行去核對下面邊支柱嘅編號同眼前一樣</p><div className="post-list">{nearestPosts.map(p=><div className="post-item" key={p.id}><strong>{p.name}</strong><span>{formatDistance(p.distance)} · {p.direction} {Math.round(p.bearing)}°</span><button type="button" className="post-confirm" onClick={()=>setConfirmedLandmark(p)}>我就在這支旁邊</button><a href={mapsAppLink(p.lat,p.lng,p.name)} target="_blank" rel="noreferrer">🧭 開路線（要網絡）</a></div>)}</div></section>}
        <LandmarkSelector database={facilityDb} position={shown ? {lat:shown.coords.latitude,lng:shown.coords.longitude} : null} installedLamps={installedLamps} selected={confirmedLandmark} onSelect={place=>setConfirmedLandmark(place)} onClear={()=>setConfirmedLandmark(null)}/>
      </>}

      {tab === 'prepare' && (
        <section>
          <div className="section-head">
            <div>
              <span className="eyebrow">LIVE SAFETY DATA</span>
              <h2>出發前即時資訊</h2>
            </div>
            <button className="primary compact" disabled={refreshing || !online} onClick={refresh}>
              {refreshing ? '更新中…' : online ? '一鍵刷新' : '目前離線'}
            </button>
          </div>

          <div className="safety-briefing">
            <h3>🚨 出發前安全重點指引</h3>
            <div className="briefing-grid">
              <div className={`briefing-card ${closedTrails.length ? 'danger' : trailsFeed?.state === 'fresh' ? 'good' : 'warning'}`}>
                <strong>{closedTrails.length ? `🚨 ${closedTrails.length} 條行山徑封閉／改道` : trailsFeed?.state === 'fresh' ? '🟢 行山徑未有封閉報告' : '⚪ 山徑狀況待更新'}</strong>
                <p>
                  {closedTrails.length
                    ? `包括：${closedTrails.slice(0, 3).map(t => t.title).join('、')}${closedTrails.length > 3 ? ` 等共 ${closedTrails.length} 處` : ''}。出發前請確認行程避開受阻路段。`
                    : trailsFeed?.state === 'fresh'
                    ? '漁護署目前沒有發布行山徑暫停開放消息。'
                    : '請按右上角刷新以取得漁護署最新路況。'}
                </p>
              </div>

              <div className={`briefing-card ${activeWarnings.length ? 'danger' : weatherNowFeed?.items?.length ? 'good' : 'warning'}`}>
                <strong>{activeWarnings.length ? `⚠️ 天氣警告生效中（${activeWarnings.length} 項）` : weatherNowFeed?.items?.length ? '🌤️ 天氣狀況良好' : '⚪ 天氣資訊待更新'}</strong>
                <p>
                  {activeWarnings.length
                    ? activeWarnings.map(w => w.title).join('、') + '。請注意戶外天氣突變與防曬防雨。'
                    : weatherNowFeed?.items?.find(i => i.title === '現時氣溫')?.detail || '天文台目前未有發出暴雨、酷熱或雷暴警告。'}
                </p>
              </div>

              <div className={`briefing-card ${closedFacilities.length ? 'warning' : facilitiesFeed?.state === 'fresh' ? 'good' : 'warning'}`}>
                <strong>{closedFacilities.length ? `💧 ${closedFacilities.length} 個郊野設施／加水點關閉` : facilitiesFeed?.state === 'fresh' ? '🟢 郊野主要設施正常開放' : '⚪ 設施狀況待更新'}</strong>
                <p>
                  {closedFacilities.length
                    ? '部分郊野公廁、涼亭或加水站暫停開放，請勿依賴現場補水，自備足量飲用水。'
                    : '未接獲郊野公園設施臨時暫停開放通報。'}
                </p>
              </div>

              <div className={`briefing-card ${trafficIncidents.length ? 'warning' : trafficFeed?.state === 'fresh' ? 'good' : 'warning'}`}>
                <strong>{trafficIncidents.length ? `🚗 全港共 ${trafficIncidents.length} 宗特別交通消息` : trafficFeed?.state === 'fresh' ? '🟢 全港主要道路順暢' : '⚪ 交通消息待更新'}</strong>
                <p>
                  {trafficIncidents.length
                    ? '全港有道路事故或改道措施；出發前往登山口前請留意接駁巴士班次。'
                    : '運輸署目前未有發布重大特別交通消息。'}
                </p>
              </div>
            </div>
          </div>

          <div className="preflight">
            <h3>出發前系統檢查</h3>
            {preflight.map(x => (
              <div key={x.label} className={x.ok ? 'pass' : 'attention'}>
                <span>{x.ok ? '✓' : '!'}</span>
                <div>
                  <strong>{x.label}</strong>
                  <small>{x.detail}</small>
                </div>
              </div>
            ))}
          </div>

          <p className="warning">更新失敗不代表沒有警告，舊資料會保留作參考；遇到突發情況請依現場指示。</p>

          <div className="feed-list">
            {feeds.map(f => (
              <article key={f.id} className={`feed ${f.state}`}>
                <div>
                  <span className="source">{f.source}</span>
                  <h3>{f.name}</h3>
                  <p>{f.message}</p>
                  <small>
                    {f.state === 'fresh' ? '目前快照抓取時間' : '過往快取抓取時間'}：{feedTime(f)}
                    {f.state === 'fresh' && f.items?.some(i => i.publishedAt && Date.now() - Date.parse(i.publishedAt) > 90 * 24 * 60 * 60 * 1000)
                      ? ' · 部分消息為長期生效'
                      : ''}
                  </small>
                  {f.items && f.items.length > 0 && (
                    <details className={`feed-details ${f.state === 'cached' ? 'past' : ''}`}>
                      <summary>
                        {f.state === 'cached'
                          ? `過往消息快取（${f.items.length} 項，非目前狀態）`
                          : `展開查看全部 ${f.items.length} 項詳細資料`}
                      </summary>
                      {f.state === 'cached' && <p className="past-warning">此為最後一次成功取得之舊快取，僅於無網絡時供參考</p>}
                      {f.items.map((item, i) => {
                        const isClosed = item.detail?.includes('封閉') || item.title.includes('封閉');
                        const isDivert = item.detail?.includes('改道') || item.title.includes('改道');
                        const isCancel = item.statusBadge === '已取消' || item.statusBadge === '完結';
                        const isAlert = item.statusBadge === '生效中' || item.title.includes('警告');
                        return (
                          <div className="feed-item" key={i}>
                            <div className="feed-item-header">
                              {isClosed ? (
                                <span className="feed-tag tag-danger">封閉</span>
                              ) : isDivert ? (
                                <span className="feed-tag tag-warning">改道</span>
                              ) : isAlert ? (
                                <span className="feed-tag tag-danger">警告</span>
                              ) : isCancel ? (
                                <span className="feed-tag tag-info">已取消</span>
                              ) : null}
                              <strong>{item.title}</strong>
                            </div>
                            {item.detail && <p>{item.detail}</p>}
                            {item.publishedAt ? (
                              <small>📅 官方時間：{item.publishedAt}</small>
                            ) : (
                              <small>🕒 隨本次即時快照發布</small>
                            )}
                          </div>
                        );
                      })}
                    </details>
                  )}
                </div>
                <span className="badge">{stateLabel(f)}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'download' && <section><span className="eyebrow">OFFLINE CONTENT</span><h2>離線資料</h2>{storage&&<div className="storage"><span>此網站已用空間</span><strong>{(storage.usage/1048576).toFixed(1)} MB</strong><small>瀏覽器可用配額約 {(storage.quota/1073741824).toFixed(1)} GB；實際可用量由裝置決定</small><small>儲存保留：{storagePersistent===true?'已允許':storagePersistent===false?'未允許，資料可能被瀏覽器清理':'未能確認'}</small><div className="readiness-actions"><button onClick={requestPersistentStorage}>要求保留離線資料</button><button disabled={offlineChecking} onClick={runOfflineCheck}>{offlineChecking?'檢查中…':'檢查離線完整性'}</button></div>{readiness&&<strong className="readiness-result">{readiness}</strong>}</div>}<div className="download-card ready"><div><h3>全港基本設施</h3><p>公廁、AED、消防局等設施資料，可更新到手機度</p><div className="download-actions"><button disabled={facilityUpdating} onClick={updateFacilities}>{facilityUpdating?'更新中…':'更新官方設施資料'}</button>{facilityOverridden&&<button onClick={restoreBundledFacilities}>還原內置版本</button>}</div>{facilityProgress&&<small>{facilityProgress}</small>}</div><span>{facilityDb?.items.length ? `${facilityDb.items.length.toLocaleString()} 項 · ${facilityDb.version}` : '尚未建立'}</span></div><div className="download-card dtm-download"><div><h3>官方5米 DTM（鏡頭比對必需）</h3><p>地政總署全港 ArcInfo ASCII Grid 官方檔案。解壓後約290MB；使用前請預留裝置空間。每次選取 ZIP/ASC，App 會在本機背景裁切所選地區並保存5米網格。山地被植被覆蓋時數值可能反映植被高度，且資料來自2014–2015年航照。</p><div className="download-actions"><a className="dtm-source-link" href="https://www.landsd.gov.hk/landsd_psi_data/SMO/data/Whole_HK_DTM_5m.zip" target="_blank" rel="noreferrer">⬇ 下載地政總署全港 DTM ZIP</a><a className="dtm-source-link" href="https://data.gov.hk/en/terms-and-conditions" target="_blank" rel="noreferrer">查看使用條款</a></div><div className="district-list">{MAP_REGIONS.map(r=>{const installed=dtmMaps.find(x=>x.id===r.id&&x.complete);return <div key={`dtm-${r.id}`}><span>{r.name} · {installed?`5米 DTM ✓ · ${(installed.bytes/1048576).toFixed(1)} MB`:'尚未匯入5米 DTM'}</span>{dtmBusy===r.id?<button disabled>匯入中…</button>:<><label className="dtm-import-label">{installed?'重新匯入':'選取ZIP／ASC'}<input type="file" accept=".zip,.asc,application/zip" disabled={!!dtmBusy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void importDtm(r,file)}}/></label>{installed&&<button disabled={!!dtmBusy} onClick={async()=>{await removeDtmRegion(r.id);setDtmMaps(await dtmInstalls());setDtmProgress(`${r.name}5米 DTM 已刪除`)}}>刪除</button>}</>}</div>})}</div>{dtmProgress&&<small>{dtmProgress}</small>}</div><span>{dtmMaps.length}區已匯入</span></div><div className="download-card map-download"><div><h3>離線底圖</h3><p>按地區下載官方底圖與標記。20米等高線舊包只作備援，不再供相機匹配；鏡頭比對需另外匯入上方的官方5米 DTM。</p><div className="district-list">{MAP_REGIONS.map(r=>{const mapDone=maps.some(x=>x.id===r.id&&x.complete);const terrainDone=terrainMaps.some(x=>x.id===r.id&&x.complete);return <div key={r.id}><span>{r.name} · {mapDone?'底圖✓':'底圖未下載'} · {terrainDone?'舊20米等高線✓':'未有舊等高線'}</span>{mapDownloading===r.id?<button onClick={()=>mapAbort.current?.abort()}>取消</button>:<><button disabled={!!mapDownloading} onClick={()=>mapDone?void removeOfflineRegion(r):void installMap(r)}>{mapDone?'刪除底圖':'下載底圖'}</button>{mapDone&&<button className="check-update" disabled={mapChecking===r.id} onClick={()=>checkMapUpdate(r)}>{mapChecking===r.id?'檢查中…':'檢查底圖新版'}</button>}</>}</div>})}</div>{mapProgress&&<small>{mapProgress}</small>}{Object.entries(mapUpdateStatus).map(([id,status])=>{const r=MAP_REGIONS.find(x=>x.id===id);return r&&status?<small key={id} className="map-update-status">{r.name}：{status}</small>:null})}</div><span>{maps.length}區已下載</span></div><div className="download-card lamp-download"><div><h3>地區燈柱</h3><p>落嚟先可以核對燈柱編號</p>{lampManifest?.districts.length?<div className="district-list">{lampManifest.districts.map(d=>{const done=installedLamps.includes(d.id);return <div key={d.id}><span>{d.name} · {d.count.toLocaleString()}支 · {(d.bytes/1048576).toFixed(1)} MB</span><button disabled={!!lampBusy} onClick={async()=>{setLampBusy(d.id);try{if(done){await removeLampDistrict(d.id)}else{await downloadLampDistrict(d,setLampProgress)}setInstalledLamps(await installedLampDistricts())}catch(e){setLampProgress(`失敗：${e instanceof Error?e.message:'未知錯誤'}`)}finally{setLampBusy(null)}}}>{lampBusy===d.id?'處理中…':(done?'刪除':'下載')}</button></div>})}</div>:<small>燈柱分區資料尚未由建置流程產生。</small>}{lampProgress&&<small>{lampProgress}</small>}</div><span>{installedLamps.length}區已下載</span></div>{!facilityLoading && facilityError && <p className="honesty">{facilityError}，故不會假裝顯示已可離線搜尋附近設施。</p>}</section>}

      {tab === 'sources' && <section className="sources-page"><span className="eyebrow">DATA TRANSPARENCY</span><h2>資料來源及版權聲明</h2><p className="source-intro">「出發前」及「附近」分頁已在 App 內完整顯示目前天氣、警告、封路、封閉山徑及設施資料，毋須另外前往官方網站查看。以下連結只供核對原始出處及版權，不代表官方機構立場；資料可能延遲���缺漏或暫時無法取得，使用前請查看每項資料的狀態及時間。</p><div className="source-list"><article><div><h3>香港地政總署 · 地圖底圖及標記</h3><p>用於地圖顯示、香港地圖方格及離線底圖。</p></div><a href="https://www.landsd.gov.hk/" target="_blank" rel="noreferrer">地政總署 ↗</a></article><article><div><h3>香港天文台 · 天氣警告</h3><p>用於顯示目前天氣警告及官方發布時間。</p></div><a href="https://www.hko.gov.hk/tc/wxinfo/currwx/" target="_blank" rel="noreferrer">香港天文台 ↗</a></article><article><div><h3>運輸署 · 封路及交通事故</h3><p>用於顯示交通消息及道路狀況。</p></div><a href="https://www.td.gov.hk/" target="_blank" rel="noreferrer">運輸署 ↗</a></article><article><div><h3>漁農自然護理署／CSDI · 封閉山徑及郊野設施</h3><p>用於顯示封閉山徑、關閉設施及其地圖位置。官方資料日期與本機刷新時間分開顯示。</p></div><a href="https://portal.csdi.gov.hk/" target="_blank" rel="noreferrer">CSDI ↗</a></article><article><div><h3>山形地形資料 · 地政總署5米 DTM</h3><p>目前鏡頭候選比對使用官方5米格網 DTM；資料來源：香港特別行政區政府地政總署，經 DATA.GOV.HK／CSDI Portal 提供。依條款標示來源及權利人；政府標示精度±5米（90%信心水準），資料以「現狀」提供。20米 ELEVLINE 是舊備援包，不供目前相機匹配使用。</p><small className="source-record">Source: Lands Department, Digital Terrain Model (DTM), via DATA.GOV.HK / CSDI Portal. © Government of the Hong Kong SAR. Reuse subject to the portals' terms of use; the dataset itself is not for resale.</small></div><a href="https://data.gov.hk/tc-data/dataset/hk-landsd-openmap-5m-grid-dtm" target="_blank" rel="noreferrer">官方 DTM ↗</a></article><article><div><h3>政府部門設施資料</h3><p>{facilityDb?.sources.length ? `本機目前版本包含 ${facilityDb.sources.length} 個來源；最近建置／更新：${facilityDb.generatedAt ? formatHkt(facilityDb.generatedAt) : '未有時間'}` : '尚未下載或建立設施資料。下載後會在此顯示實際來源及抓取時間。'}</p>{facilityDb?.sources.map(source=><small className="source-record" key={source.url}>{source.name} · 抓取：{formatHkt(source.retrievedAt)} · <a href={source.url} target="_blank" rel="noreferrer">原始連結</a></small>)}</div></article><article><div><h3>裝置定位及離線資料</h3><p>目前位置來自使用者裝置的 GNSS／定位服務；燈柱資料下載後會顯示其官方資料來源。離線資料只會在完成驗證後標示為可用。</p></div></article></div><div className="copyright-box"><strong>版權及使用限制</strong><p>地圖、政府資料及各資料集的版權、授權及使用條款歸原資料提供者所有。Scout System 不主張擁有上述資料；請遵守各官方網站的授權、署名及再發布要求。App 內容只供戶外安全輔助，緊急情況請致電 999／112。</p></div></section>}

      {tab === 'nearby' && <section><span className="eyebrow">NEARBY</span><h2>附近資訊</h2>{!referencePoint ? <div className="empty">先去「定位」攞位置</div> : facilityLoading ? <div className="empty">正在載入內置設施資料…</div> : facilityError ? <div className="empty">{facilityError}。睇到柱號都可以去「定位」核對</div> : <><div className="filters">{(['all','toilet','aed','water','fire_station','ambulance_station','police','hospital','distance_post'] as const).map(t=><button className={facilityType===t?'active':''} key={t} onClick={()=>setFacilityType(t)}>{t==='all'?'全部':facilityName[t]}</button>)}</div><p className="near-note">直線距離，唔等於行嘅路程</p><div className="near-list">{nearby.map(x=><article key={x.id}><div><span className="source">{facilityName[x.type]} · {x.source}</span><h3>{x.name}</h3>{x.address&&<p>{x.address}</p>}{x.hours&&<small>開放時間：{x.hours}</small>}{x.detail&&<small>{x.detail}</small>}{x.phone&&<a className="facility-phone" href={`tel:${x.phone.replace(/[^\d+]/g,'')}`}>電話：{x.phone}</a>}</div><div className="distance"><strong>{formatDistance(x.distance)}</strong><span>{x.direction} · {Math.round(x.bearing)}°</span><a className="maps-link" href={mapsAppLink(x.lat,x.lng,x.name)} target="_blank" rel="noreferrer">🧭 開地圖</a></div></article>)}</div></>}</section>}
    </main>
    <footer><strong>Scout System</strong><br/>安全資訊只供輔助 · 遇到即時危險請致電 999／112<br/><span>© 2026 Scout System · 資料來源及地圖版權歸各官方機構所有</span></footer>
    {sosOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSosOpen(false)}}><section className="sos-panel" role="dialog" aria-modal="true" aria-labelledby="sos-title"><button className="modal-close" onClick={()=>setSosOpen(false)} aria-label="關閉">×</button><span className="eyebrow red">EMERGENCY</span><h2 id="sos-title">求救</h2><div className="call-actions"><a className="call" href="tel:999"><strong>999</strong><span>📞 香港報案</span></a><a className="call secondary-call" href="tel:112"><strong>112</strong><span>📞 國際求救</span></a></div><p className="sos-note">撳一下就打出去 · 112 未必接通</p>{!shown?<p className="danger-message">未有位置，同對方講附近地標就得</p>:<><div className={`position-health ${positionAge!==null&&positionAge>300?'stale':''}`}><strong>{locked?'已鎖定裝置位置':'裝置定位位置'}</strong><span>誤差 ±{Math.round(shown.accuracy)} 米 · {(positionAge??0)<60?`${positionAge} 秒前`:`${Math.floor((positionAge??0)/60)} 分鐘前`}</span></div>{positionAge!==null&&positionAge>300&&<p className="danger-message">位置隔咗好耐，最好再定位一次</p>}{shown.accuracy>100&&<p className="danger-message">誤差好大，講埋附近地標會更準</p>}</>}<pre className="report">{report}</pre>{copyState&&<p className="copy-state">{copyState}</p>}<div className="report-actions"><button onClick={copyReport}>📋 複製</button><button onClick={()=>shareOrCopy(report,'緊急報位資料')}>📤 分享</button></div></section></div>}
    <Analytics />
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
