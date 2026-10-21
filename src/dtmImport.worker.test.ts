import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { convertCoordinates } from './coordinates';
import { cropDtmFile } from './dtmAscii';
import type { MapRegion } from './offlineMaps';

function syntheticAsc(region:MapRegion):string{
  const corners=[[region.bounds[1],region.bounds[0]],[region.bounds[1],region.bounds[2]],[region.bounds[3],region.bounds[0]],[region.bounds[3],region.bounds[2]]].map(([lng,lat])=>convertCoordinates(lat,lng));
  const minX=Math.min(...corners.map(point=>point.hkE))-50,maxX=Math.max(...corners.map(point=>point.hkE))+50;
  const minY=Math.min(...corners.map(point=>point.hkN))-50,maxY=Math.max(...corners.map(point=>point.hkN))+50;
  const cell=5,ncols=Math.ceil((maxX-minX)/cell),nrows=Math.ceil((maxY-minY)/cell);
  const header=`ncols ${ncols}\nnrows ${nrows}\nxllcorner ${minX}\nyllcorner ${minY}\ncellsize ${cell}\nNODATA_value -9999\n`;
  return header+`${Array.from({length:ncols},()=>123.4).join(' ')}\n`.repeat(nrows);
}

describe('5m DTM ASCII crop',()=>{
  const region:MapRegion={id:'dtm-test',name:'測試區',bounds:[22.30,114.10,22.31,114.11]};
  it('reads an ASC file and keeps the selected region at 5m resolution',async()=>{
    const messages:string[]=[];
    const grid=await cropDtmFile(new File([syntheticAsc(region)],'synthetic.asc'),region,message=>messages.push(message));
    expect(grid.cellSize).toBe(5);
    expect(grid.width).toBeGreaterThan(0);
    expect(grid.height).toBeGreaterThan(0);
    expect(grid.values).toHaveLength(grid.width*grid.height);
    expect(grid.values.every(value=>value===1234)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('streams and crops an ASC file from the official ZIP format',async()=>{
    const archive=zipSync({'Whole_HK_DTM_5m.asc':strToU8(syntheticAsc(region))});
    const file=new File([archive],'Whole_HK_DTM_5m.zip',{type:'application/zip'});
    const grid=await cropDtmFile(file,region,()=>{});
    expect(grid.cellSize).toBe(5);
    expect(grid.values.length).toBe(grid.width*grid.height);
    expect(grid.values.every(value=>value===1234)).toBe(true);
  });
});
