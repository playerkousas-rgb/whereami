import { useEffect, useRef, useState } from 'react';
import { MAP_REGIONS } from './offlineMaps';
import { loadTerrainRegion, type TerrainInstall } from './terrainData';
import { extractSkylineProfile, matchTerrainViews, type SkylineView, type TerrainCandidate, type TerrainMatch, type TerrainPackage } from './terrainMatcher';

interface Props { terrainRegions?: TerrainInstall[]; onBestCandidate?: (candidate: TerrainCandidate | null) => void; }
type OrientationPermissionEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
type CompassOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number | null };
const normalizeHeading = (value: number) => ((value % 360) + 360) % 360;
function cameraAzimuth(event: CompassOrientationEvent): number | null {
  const nativeHeading = event.webkitCompassHeading;
  const rawAlpha = typeof nativeHeading === 'number' && Number.isFinite(nativeHeading)
    ? normalizeHeading(360 - nativeHeading)
    : event.alpha;
  if (typeof rawAlpha !== 'number' || typeof event.beta !== 'number' || typeof event.gamma !== 'number') return null;
  // Rotate the rear-camera optical axis (device -Z) into the horizontal north/east plane.
  // This compensates for portrait/landscape tilt instead of treating screen-top heading as lens heading.
  const alpha = rawAlpha * Math.PI / 180, beta = event.beta * Math.PI / 180, gamma = event.gamma * Math.PI / 180;
  const east = -Math.cos(alpha) * Math.sin(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma);
  const north = -Math.sin(alpha) * Math.sin(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma);
  if (Math.hypot(east, north) < 0.2) return null;
  return normalizeHeading(Math.atan2(east, north) * 180 / Math.PI);
}

export default function TerrainCamera({ terrainRegions = [], onBestCandidate }: Props) {
  const [open, setOpen] = useState(false);
  const [cameraState, setCameraState] = useState<'idle'|'starting'|'ready'|'error'>('idle');
  const [message, setMessage] = useState('');
  const [compassEnabled, setCompassEnabled] = useState(false);
  const [compassHeading, setCompassHeading] = useState<number|null>(null);
  const [manualHeading, setManualHeading] = useState('');
  const [compassMessage, setCompassMessage] = useState('');
  const [horizontalFov, setHorizontalFov] = useState(60);
  const [views, setViews] = useState<SkylineView[]>([]);
  const [matchProgress, setMatchProgress] = useState('');
  const [matching, setMatching] = useState(false);
  const [match, setMatch] = useState<TerrainMatch|null>(null);
  const videoRef = useRef<HTMLVideoElement|null>(null);
  const streamRef = useRef<MediaStream|null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraState('starting');
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setMessage('此瀏覽器不支援鏡頭存取；請使用 HTTPS 網站及較新的瀏覽器。');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState('ready');
    }).catch(error => {
      if (cancelled) return;
      setCameraState('error');
      const name = error instanceof DOMException ? error.name : '';
      setMessage(name === 'NotAllowedError'
        ? '未獲鏡頭權限。請在瀏覽器設定允許相機存取後重試。'
        : name === 'NotFoundError'
        ? '找不到可用的後置鏡頭。'
        : '未能啟動鏡頭；請確認相機沒有被其他 App 使用後重試。');
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !compassEnabled) return;
    const handleOrientation = (event: CompassOrientationEvent) => {
      if (!event.absolute && typeof event.webkitCompassHeading !== 'number') return;
      const heading = cameraAzimuth(event);
      if (heading !== null) { setCompassHeading(heading); setCompassMessage(''); }
    };
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener);
    const timer = window.setTimeout(() => {
      setCompassMessage(current => current || '裝置未提供絕對指南針讀數；可用外置指南針量度鏡頭方位，再手動輸入。');
    }, 3000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('deviceorientationabsolute', handleOrientation as EventListener);
    };
  }, [open, compassEnabled]);

  const enableCompass = async () => {
    setCompassMessage('');
    try {
      const sensor = DeviceOrientationEvent as OrientationPermissionEvent;
      if (typeof sensor.requestPermission === 'function' && await sensor.requestPermission() !== 'granted') {
        setCompassMessage('未獲指南針權限；可在瀏覽器設定開啟後重試。');
        return;
      }
      setCompassHeading(null);
      setCompassEnabled(true);
    } catch {
      setCompassMessage('未能啟動指南針；請確認瀏覽器支援並允許感應器存取。');
    }
  };

  const captureView = () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) { setCompassMessage('鏡頭影像尚未就緒，請稍候再拍。'); return; }
    const heading = manualHeading.trim() ? Number(manualHeading) : compassHeading;
    if (heading == null || !Number.isFinite(heading) || heading < 0 || heading >= 360) { setCompassMessage('請先啟用指南針，或輸入鏡頭朝向的真北方位（0–359°）。'); return; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('瀏覽器無法分析鏡頭畫面');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const profile = extractSkylineProfile(context.getImageData(0, 0, canvas.width, canvas.height));
      setViews(current => [...current, { heading: normalizeHeading(heading), profile, horizontalFov }]);
      setMatch(null); onBestCandidate?.(null); setMatchProgress('');
      setCompassMessage(`已記錄方位 ${Math.round(heading)}° 的山脊輪廓；請轉向另一方向再拍。`);
    } catch (error) {
      setCompassMessage(error instanceof Error ? error.message : '未能辨認山脊輪廓');
    }
  };

  const runMatch = async () => {
    setMatching(true); setMatch(null); setMatchProgress('載入本機等高線資料…');
    try {
      const installed = terrainRegions.filter(item => item.complete);
      if (!installed.length) throw new Error('未找到完整的離線地形資料。請先下載觀察區附近的地圖及等高線。');
      const packages: TerrainPackage[] = [];
      for (const item of installed) {
        const region = MAP_REGIONS.find(candidate => candidate.id === item.id);
        if (!region) continue;
        setMatchProgress(`讀取${item.name}離線等高線…`);
        packages.push({ region, features: await loadTerrainRegion(item.id) });
      }
      if (!packages.length) throw new Error('沒有可讀取的離線地形資料。');
      const result = await matchTerrainViews(views, packages, setMatchProgress);
      setMatch(result);
      onBestCandidate?.(result.candidates[0] || null);
      setMatchProgress('比對完成');
    } catch (error) {
      setMatchProgress(error instanceof Error ? error.message : '山形比對失敗；請檢查離線資料後重試。');
      onBestCandidate?.(null);
    } finally { setMatching(false); }
  };

  const resetViews = () => { setViews([]); setMatch(null); setMatchProgress(''); onBestCandidate?.(null); };
  const close = () => { setCompassEnabled(false); setCompassHeading(null); setOpen(false); };
  const completeRegions = terrainRegions.filter(item => item.complete).length;

  return <>
    <section className="terrain-entry" aria-labelledby="terrain-camera-title">
      <div className="terrain-entry-copy">
        <span className="eyebrow">GPS BACKUP · CAMERA</span>
        <h2 id="terrain-camera-title">用鏡頭比對山形</h2>
        <p>擷取不同方向的山脊輪廓，與已下載等高線做本機候選位置比對。</p>
      </div>
      <button className="terrain-open" onClick={() => setOpen(true)}>📷 開始山形比對</button>
      {!completeRegions && <small className="terrain-status">尚未下載完整地形資料</small>}
    </section>
    {open && <div className="terrain-camera-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section className="terrain-camera-panel" role="dialog" aria-modal="true" aria-labelledby="terrain-dialog-title">
        <div className="terrain-camera-head">
          <div><span className="eyebrow">EXPERIMENTAL TERRAIN MATCH</span><h2 id="terrain-dialog-title">山形候選位置比對</h2></div>
          <button className="terrain-close" onClick={close} aria-label="關閉鏡頭">×</button>
        </div>
        <div className="terrain-viewfinder">
          {cameraState === 'starting' && <div className="terrain-camera-message">正在啟動後置鏡頭…</div>}
          {cameraState === 'error' && <div className="terrain-camera-message">{message}</div>}
          <video ref={videoRef} autoPlay muted playsInline aria-label="後置鏡頭即時畫面" />
          {cameraState === 'ready' && <div className="terrain-reticle" aria-hidden="true"><span/><i/><b/></div>}
          {cameraState === 'ready' && <span className="terrain-camera-badge">鏡頭已開啟</span>}
          {compassHeading !== null && <span className="terrain-heading-badge">方位 {Math.round(compassHeading)}°</span>}
        </div>
        <div className="terrain-camera-info">
          <p className="terrain-safety">試驗功能：以相機畫面和20米等高線作粗略匹配，候選位置可能錯誤；不是 GPS，亦未經現場驗證。請勿單獨用於求救／導航。</p>
          <div className="terrain-controls">
            {!compassEnabled && <button className="terrain-retry" onClick={enableCompass}>🧭 啟用指南針</button>}
            <label>手動鏡頭方位（真北°）<input aria-label="手動鏡頭真北方位" inputMode="numeric" type="number" min="0" max="359" placeholder={compassHeading == null ? '例如 45' : `${Math.round(compassHeading)}`} value={manualHeading} onChange={event => setManualHeading(event.target.value)}/></label>
            <label>鏡頭水平視角 {horizontalFov}°<input aria-label="鏡頭水平視角" type="range" min="40" max="80" step="5" value={horizontalFov} onChange={event => setHorizontalFov(Number(event.target.value))}/></label>
          </div>
          <p>保持手機水平，鏡頭對準清楚的山脊線。先記錄一個方向，再原地轉向至少約25°，總共記錄三個不同方向；手機指南針的鏡頭方位仍可能有偏差。</p>
          {cameraState === 'ready' && <button className="terrain-action" onClick={captureView}>＋ 記錄目前山形方向</button>}
          <div className="terrain-view-list" aria-live="polite">
            {views.map((view, index) => <span key={`${index}-${view.heading}`}>方向 {Math.round(view.heading)}° · 輪廓 {index + 1}</span>)}
            {views.length > 0 && <button onClick={resetViews}>清除並重拍</button>}
          </div>
          {compassMessage && <p className="terrain-sensor-message" role="status">{compassMessage}</p>}
          {completeRegions > 0 && <p>本機完整地形區域：{terrainRegions.filter(item => item.complete).map(item => item.name).join('、')}（20米等高線）</p>}
          {completeRegions === 0 && <p>未有完整離線地形資料；請先回到下載頁，下載觀察區附近資料。</p>}
          {views.length >= 3 && <button className="terrain-action terrain-match-button" disabled={matching || completeRegions === 0} onClick={runMatch}>{matching ? '正在比對…' : '⌖ 比對候選位置'}</button>}
          {matchProgress && <p className="terrain-match-progress" role="status">{matchProgress}</p>}
          {match && <div className="terrain-match-results" aria-live="polite">
            <strong>候選位置（不是定位 fix）</strong>
            <p>{match.message}</p>
            <ol>{match.candidates.map((candidate, index) => <li key={`${candidate.lat}-${candidate.lng}`}>
              <b>候選 {index + 1}</b>：{candidate.lat.toFixed(5)}, {candidate.lng.toFixed(5)} · 比對差 {candidate.scoreDegrees.toFixed(2)}° · 粗略不確定度約 ±{Math.round(candidate.uncertaintyMetres)}m（未校準）
              <small>{candidate.region} · {candidate.confidence === 'possible' ? '相對較吻合，但仍需現場確認' : '低信心，請勿依賴'}</small>
            </li>)}</ol>
          </div>}
          {cameraState === 'error' && <button className="terrain-retry" onClick={() => { setOpen(false); window.setTimeout(() => setOpen(true), 0); }}>重試開啟鏡頭</button>}
        </div>
      </section>
    </div>}
  </>;
}
