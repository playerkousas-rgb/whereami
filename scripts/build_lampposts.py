#!/usr/bin/env python3
import hashlib,json,re,ssl,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/data/lampposts';OUT.mkdir(parents=True,exist_ok=True)
URL='https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=hyd_rcd_1629267205229_84645&format=geojson&layer_name=Lamppost'
SLUG={'Central & Western':'central-western','Wan Chai':'wan-chai','Eastern':'eastern','Southern':'southern','Yau Tsim Mong':'yau-tsim-mong','Sham Shui Po':'sham-shui-po','Kowloon City':'kowloon-city','Wong Tai Sin':'wong-tai-sin','Kwun Tong':'kwun-tong','Kwai Tsing':'kwai-tsing','Tsuen Wan':'tsuen-wan','Tuen Mun':'tuen-mun','Yuen Long':'yuen-long','North':'north','Tai Po':'tai-po','Sha Tin':'sha-tin','Sai Kung':'sai-kung','Islands':'islands'}
req=urllib.request.Request(URL,headers={'User-Agent':'whereami-hk/0.1'});data=json.load(urllib.request.urlopen(req,timeout=300,context=ssl.create_default_context()));groups=defaultdict(list)
for f in data.get('features',[]):
 p=f.get('properties') or {};c=(f.get('geometry') or {}).get('coordinates') or []
 try:lng,lat=float(c[0]),float(c[1])
 except:continue
 num=str(p.get('LAMP_NO') or '').strip();district=str(p.get('DISTRICT') or 'Unknown').strip()
 if num and 22<=lat<=23 and 113<=lng<=115:groups[district].append({'n':num,'a':round(lat,6),'o':round(lng,6),'s':str(p.get('PRIMARY_ST') or '').strip()})
manifest={'version':datetime.now(timezone.utc).date().isoformat(),'generatedAt':datetime.now(timezone.utc).isoformat(),'districts':[]}
for district,items in sorted(groups.items()):
 slug=SLUG.get(district,re.sub(r'[^a-z0-9]+','-',district.lower()).strip('-') or 'unknown');raw=json.dumps(items,ensure_ascii=False,separators=(',',':')).encode();path=OUT/f'{slug}.json';path.write_bytes(raw);manifest['districts'].append({'id':slug,'name':district,'count':len(items),'bytes':len(raw),'file':f'/data/lampposts/{slug}.json','sha256':hashlib.sha256(raw).hexdigest()})
if sum(x['count'] for x in manifest['districts'])<100000:raise SystemExit('Refusing incomplete lamppost dataset')
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print('Wrote',sum(x['count'] for x in manifest['districts']),'lampposts')
