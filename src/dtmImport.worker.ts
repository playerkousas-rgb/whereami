import { cropDtmFile } from './dtmAscii';
import type { MapRegion } from './offlineMaps';

self.onmessage = (event: MessageEvent<{file:File;region:MapRegion}>) => {
  cropDtmFile(event.data.file,event.data.region,message=>self.postMessage({type:'progress',message}))
    .then(grid=>{
      (self as unknown as {postMessage:(message:unknown,transfer:Transferable[])=>void}).postMessage(
        {type:'done',grid},[grid.values.buffer as ArrayBuffer],
      );
    })
    .catch(error=>self.postMessage({type:'error',message:error instanceof Error?error.message:'DTM 解壓或解析失敗'}));
};
