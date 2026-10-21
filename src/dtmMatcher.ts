import proj4 from 'proj4';
import './coordinates';
import type { DtmGrid } from './dtmData';
import type { SkylineView, TerrainCandidate, TerrainMatch } from './terrainMatcher';

const normalize = (value:number) => ((value % 360) + 360) % 360;
const radians = (value:number) => value * Math.PI / 180;
const yieldToUi = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve,0);
});

function elevationAt(grid:DtmGrid,east:number,north:number):number|null {
  const col = Math.round((east - grid.xCenter0) / grid.cellSize);
  const row = Math.round((grid.northCenter0 - north) / grid.cellSize);
  if(col<0||row<0||col>=grid.width||row>=grid.height)return null;
  const value=grid.values[row*grid.width+col];
  return value===grid.nodata?null:value/10;
}
function gridConvergence(east:number,north:number):number{
  const [lng,lat]=proj4('EPSG:2326','EPSG:4326',[east,north]);
  const [northEast,northNorth]=proj4('EPSG:4326','EPSG:2326',[lng,lat+0.001]);
  return Math.atan2(northEast-east,northNorth-north)*180/Math.PI;
}
function predicted(grid:DtmGrid,east:number,north:number,base:number,view:SkylineView,convergence=0):number[]|null{
  const bins=view.profile.length,profile:number[]=[];let valid=0;
  for(let bin=0;bin<bins;bin++){
    const bearing=radians(normalize(view.heading+convergence+((bin+0.5)/bins-0.5)*view.horizontalFov));
    const dx=Math.sin(bearing),dy=Math.cos(bearing);let horizon=-5,samples=0;
    for(let distance=100;distance<=12_000;distance+=100){
      const value=elevationAt(grid,east+dx*distance,north+dy*distance);
      if(value==null)continue;
      samples++;
      const angle=Math.atan2(value-base,distance)*180/Math.PI;
      if(angle>horizon)horizon=angle;
    }
    if(samples>=5&&horizon>-5)valid++;
    profile.push(horizon);
  }
  if(valid<bins*0.65)return null;
  const mean=profile.reduce((sum,value)=>sum+value,0)/bins;
  return profile.map(value=>value-mean);
}
export function predictDtmSkyline(grid:DtmGrid,east:number,north:number,heading:number,horizontalFov=60,bins=24):number[]{
  const ground=elevationAt(grid,east,north);
  if(ground==null)throw new Error('DTM 測試點沒有有效高度');
  const profile=predicted(grid,east,north,ground+1.6,{heading,horizontalFov,profile:Array.from({length:bins},()=>0)},gridConvergence(east,north));
  if(!profile)throw new Error('DTM 測試點周邊覆蓋不足');
  return profile;
}

function rms(a:number[],b:number[]):number{
  let sum=0;for(let i=0;i<a.length;i++)sum+=(a[i]-b[i])**2;
  return Math.sqrt(sum/a.length);
}

export async function matchDtmViews(views:SkylineView[],grids:DtmGrid[],onProgress?:(text:string)=>void):Promise<TerrainMatch>{
  if(views.length<3)throw new Error('請從至少三個不同方向各拍一張山形畫面，再開始比對。');
  const headings=views.map(view=>view.heading).sort((a,b)=>a-b);
  const gaps=headings.slice(0,-1).map((heading,index)=>headings[index+1]-heading);
  gaps.push(360-headings[headings.length-1]+headings[0]);
  if(360-Math.max(...gaps)<25)throw new Error('三個鏡頭方向太接近；請原地轉向不同方向重新拍攝。');
  const calculatedAt=new Date().toISOString(),candidates:TerrainCandidate[]=[];
  for(const grid of grids){
    onProgress?.(`正在搜尋${grid.name}5米 DTM…`);
    const eMin=grid.xCenter0-grid.cellSize/2,eMax=eMin+grid.width*grid.cellSize;
    const nMax=grid.northCenter0+grid.cellSize/2,nMin=nMax-grid.height*grid.cellSize;
    const step=400;let rows=0;
    for(let north=nMin+step;north<nMax-step;north+=step){
      rows++;
      for(let east=eMin+step;east<eMax-step;east+=step){
        const baseGround=elevationAt(grid,east,north);
        if(baseGround==null)continue;
        let scoreSum=0,usable=0;
        const convergence=gridConvergence(east,north);
        for(const view of views){
          const profile=predicted(grid,east,north,baseGround+1.6,view,convergence);
          if(!profile)continue;
          scoreSum+=rms(profile,view.profile);usable++;
        }
        if(usable<Math.ceil(views.length*0.75))continue;
        const [lng,lat]=proj4('EPSG:2326','EPSG:4326',[east,north]);
        if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
        const score=scoreSum/usable;
        candidates.push({lat,lng,scoreDegrees:score,confidence:score<2.5?'possible':'weak',uncertaintyMetres:Math.max(1_500,Math.round(score*750+step*0.75)),region:grid.name,calculatedAt});
      }
      if(rows%8===0){
        onProgress?.(`正在比對${grid.name}5米 DTM：${Math.min(100,Math.round((north-nMin)/(nMax-nMin)*100))}%`);
        await yieldToUi();
      }
    }
  }
  if(!candidates.length)throw new Error('DTM 覆蓋或可用山脊資料不足以產生候選位置；請匯入觀察區地形資料並在開揚位置重拍。');
  candidates.sort((a,b)=>a.scoreDegrees-b.scoreDegrees);
  const distinct:TerrainCandidate[]=[];
  for(const candidate of candidates){
    if(distinct.some(other=>Math.hypot((other.lat-candidate.lat)*111_320,(other.lng-candidate.lng)*111_320*Math.cos(radians(candidate.lat)))<600))continue;
    distinct.push(candidate);if(distinct.length>=5)break;
  }
  const best=distinct[0],plausible=best.scoreDegrees<2.5&&distinct.length>1&&distinct[1].scoreDegrees-best.scoreDegrees>0.35;
  return {
    candidates:distinct.map(candidate=>({...candidate,confidence:plausible&&candidate===best?'possible':'weak'})),
    message:plausible
      ?'找到一個較吻合的候選位置。資料取自地政總署5米 DTM（標示精度±5米），但鏡頭模型和定位分數未經野外校準，請以標距柱或 GPS 核實。'
      :'找到多個可能位置或比對度偏低；結果只供測試，請勿作為求救座標。',
  };
}
