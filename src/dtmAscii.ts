import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate';
import { convertCoordinates } from './coordinates';
import type { MapRegion } from './offlineMaps';

export interface DtmAsciiGrid {
  width:number; height:number; cellSize:number; xCenter0:number; northCenter0:number;
  values:Int16Array; nodata:number; region:MapRegion;
}
type Header = { ncols:number; nrows:number; xll:number; yll:number; cell:number; nodata:number };
type Crop = { col0:number; col1:number; row0:number; row1:number; width:number; height:number };

class DtmAsciiCropper {
  private header:Header|null=null;
  private crop:Crop|null=null;
  private values:Int16Array|null=null;
  private grid:DtmAsciiGrid|null=null;
  private dataRow=0;
  private headerPairs:string[]=[];
  private lineBuffer='';
  private decoder=new TextDecoder('utf-8');
  constructor(private region:MapRegion,private onProgress:(message:string)=>void){this.onProgress(`準備裁切${region.name}的5米格網…`);}

  private prepareGrid(lines:string[]) {
    const fields:Record<string,number>={};
    for(const line of lines){const [key,raw]=line.trim().split(/\s+/,2);if(key&&raw!=null)fields[key.toLowerCase()]=Number(raw)}
    const ncols=fields.ncols,nrows=fields.nrows,cell=fields.cellsize;
    const xll=fields.xllcorner??(fields.xllcenter!=null?fields.xllcenter-cell/2:Number.NaN);
    const yll=fields.yllcorner??(fields.yllcenter!=null?fields.yllcenter-cell/2:Number.NaN);
    const nodata=fields.nodata_value??-9999;
    if(![ncols,nrows,cell,xll,yll,nodata].every(Number.isFinite)||ncols<1||nrows<1||cell<=0||ncols>100_000||nrows>100_000)throw new Error('ASC 標頭缺少有效的 ncols/nrows/xll/yll/cellsize');
    this.header={ncols,nrows,xll,yll,cell,nodata};
    const [south,west,north,east]=this.region.bounds;
    const corners=[[west,south],[west,north],[east,south],[east,north]].map(([lng,lat])=>convertCoordinates(lat,lng));
    const minX=Math.min(...corners.map(point=>point.hkE)),maxX=Math.max(...corners.map(point=>point.hkE));
    const minY=Math.min(...corners.map(point=>point.hkN)),maxY=Math.max(...corners.map(point=>point.hkN));
    const col0=Math.max(0,Math.floor((minX-xll)/cell)),col1=Math.min(ncols-1,Math.ceil((maxX-xll)/cell)-1);
    const northCellCenter=yll+(nrows-0.5)*cell;
    const row0=Math.max(0,Math.floor((northCellCenter-maxY)/cell)),row1=Math.min(nrows-1,Math.ceil((northCellCenter-minY)/cell));
    if(col1<col0||row1<row0)throw new Error('所選地區不在 DTM 資料範圍內');
    const width=col1-col0+1,height=row1-row0+1,count=width*height;
    if(!Number.isSafeInteger(count)||count>45_000_000)throw new Error(`所選區域裁切後仍太大（${width}×${height}格）；請選較小地區`);
    this.crop={col0,col1,row0,row1,width,height};
    this.values=new Int16Array(count);this.values.fill(-32768);
    this.grid={width,height,cellSize:cell,xCenter0:xll+(col0+0.5)*cell,northCenter0:northCellCenter-row0*cell,values:this.values,nodata:-32768,region:this.region};
  }

  private parseRow(line:string) {
    const h=this.header,c=this.crop,out=this.values;
    if(!h||!c||!out)throw new Error('DTM 標頭尚未完成');
    const row=this.dataRow++;
    if(row>=h.nrows)return;
    if(row<c.row0||row>c.row1)return;
    const target=row-c.row0;
    let tokenStart=-1,column=0;
    for(let index=0;index<=line.length;index++){
      const code=line.charCodeAt(index),whitespace=index===line.length||code===32||code===9||code===13;
      if(!whitespace&&tokenStart<0)tokenStart=index;
      if(whitespace&&tokenStart>=0){
        if(column>=c.col0&&column<=c.col1){
          const value=Number(line.slice(tokenStart,index)),targetIndex=target*c.width+(column-c.col0);
          if(Number.isFinite(value)&&value!==h.nodata)out[targetIndex]=Math.max(-32767,Math.min(32767,Math.round(value*10)));
        }
        column++;tokenStart=-1;
      }
    }
    if(column!==h.ncols)throw new Error(`DTM 第 ${row+1} 列資料不完整（${column}/${h.ncols}）`);
    if(row%250===0)this.onProgress(`解析全港 DTM：${Math.round(row/h.nrows*100)}% · 裁切${this.region.name}5米格網`);
  }

  private processLine(raw:string) {
    const line=raw.trim();if(!line)return;
    if(!this.header){
      const [key,value]=line.split(/\s+/,2);
      if(!key||value==null)throw new Error('DTM ASC 標頭格式無效');
      this.headerPairs.push(`${key} ${value}`);
      if(this.headerPairs.length>=6){this.prepareGrid(this.headerPairs);this.headerPairs=[];}
      return;
    }
    this.parseRow(line);
  }

  private pushText(chunk:Uint8Array,final=false) {
    const text=this.lineBuffer+this.decoder.decode(chunk,{stream:!final});
    const lines=text.split(/\n/);
    if(final){this.lineBuffer='';for(const line of lines)this.processLine(line);}
    else{this.lineBuffer=lines.pop()??'';for(const line of lines)this.processLine(line);}
  }

  private finish():DtmAsciiGrid {
    if(!this.header||!this.crop||!this.grid||!this.values)throw new Error('找不到可讀取的 ArcInfo ASCII Grid DTM');
    if(this.dataRow<this.header.nrows)throw new Error(`DTM 資料列不完整（${this.dataRow}/${this.header.nrows}）`);
    this.grid.values=this.values;return this.grid;
  }

  private async parseAscii(stream:ReadableStream<Uint8Array>):Promise<DtmAsciiGrid>{
    const reader=stream.getReader();
    while(true){const {value,done}=await reader.read();if(value)this.pushText(value);if(done)break;}
    this.pushText(new Uint8Array(),true);return this.finish();
  }

  private async parseZip(stream:ReadableStream<Uint8Array>):Promise<DtmAsciiGrid>{
    const reader=stream.getReader();
    let resolveEntry:(grid:DtmAsciiGrid)=>void=()=>{};
    let rejectEntry:(error:Error)=>void=()=>{};
    const entryPromise=new Promise<DtmAsciiGrid>((resolve,reject)=>{resolveEntry=resolve;rejectEntry=reject;});
    let found=false;
    const unzip=new Unzip((entry:UnzipFile)=>{
      if(!entry.name.toLowerCase().endsWith('.asc'))return;
      found=true;
      entry.ondata=(error,chunk,final)=>{
        if(error){rejectEntry(new Error(error.message));return;}
        try{this.pushText(chunk,final);if(final)resolveEntry(this.finish());}
        catch(problem){rejectEntry(problem instanceof Error?problem:new Error('DTM ASC 解析失敗'));}
      };
      try{entry.start();}catch(problem){rejectEntry(problem instanceof Error?problem:new Error('ZIP 壓縮格式不支援'));}
    });
    unzip.register(UnzipInflate);unzip.register(UnzipPassThrough);
    while(true){const {value,done}=await reader.read();unzip.push(value??new Uint8Array(),done);if(done)break;}
    if(!found)throw new Error('ZIP 內找不到 .asc 地形網格檔');
    return entryPromise;
  }

  async run(file:File):Promise<DtmAsciiGrid>{
    const isZip=file.name.toLowerCase().endsWith('.zip')||file.type.includes('zip');
    return isZip?this.parseZip(file.stream()):this.parseAscii(file.stream());
  }
}

export function cropDtmFile(file:File,region:MapRegion,onProgress:(message:string)=>void):Promise<DtmAsciiGrid>{
  return new DtmAsciiCropper(region,onProgress).run(file);
}
