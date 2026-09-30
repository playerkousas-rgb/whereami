#!/usr/bin/env python3
"""Download official HK point datasets and build the compact bundled facility database.
Fails closed: no output is replaced unless every downloaded source parses successfully.
"""
from __future__ import annotations
import json, math, ssl, sys, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/data/facilities.json'
SOURCES=[
 ('AED','aed','https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=hkfsd_rcd_1695974242578_37917&format=geojson&layer_name=AED'),
 ('郊野加水站','water','https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1635133835075_48993&format=geojson&layer_name=WaterFillingStation_WaterFillingStation_Ext_GDB'),
 ('標距柱','distance_post','https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1635136039113_86105&format=geojson&layer_name=DistancePosts_DistancePosts_Ext_GDB'),
]
FEHD=('食環署公廁','https://www.fehd.gov.hk/tc/map/fehd_map_tc.xml')

def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'whereami-hk/0.1 (+https://github.com/playerkousas-rgb/whereami)'})
 with urllib.request.urlopen(req,timeout=90,context=ssl.create_default_context()) as r:return r.read()
def pick(p,*needles):
 for needle in needles:
  for k,v in p.items():
   if needle.lower() in str(k).lower() and v not in (None,''):return str(v).strip()
 return ''
def point(feature):
 g=feature.get('geometry') or {}; c=g.get('coordinates') or []
 while c and isinstance(c[0],list):c=c[0]
 if len(c)>=2 and all(isinstance(x,(int,float)) for x in c[:2]):
  lng,lat=c[:2]
  if 22<=lat<=23 and 113<=lng<=115:return lat,lng
 p=feature.get('properties') or {}
 try:
  lat=float(pick(p,'latitude','lat'));lng=float(pick(p,'longitude','long','lng'))
  if 22<=lat<=23 and 113<=lng<=115:return lat,lng
 except:pass
 raise ValueError('feature has no valid Hong Kong WGS84 point')
def parse_geo(raw,kind,source):
 d=json.loads(raw); fs=d.get('features')
 if d.get('type')!='FeatureCollection' or not isinstance(fs,list):raise ValueError(f'{source}: not FeatureCollection')
 out=[]
 for i,f in enumerate(fs):
  try:lat,lng=point(f)
  except ValueError:continue
  p=f.get('properties') or {}; code=pick(p,'fac_id','post_no','lamp_no','number','code','id','name')
  name=pick(p,'name_tc','name_chi','chinese_name','name','location_tc','location') or (f'標距柱 {code}' if kind=='distance_post' and code else code) or f'{source} {i+1}'
  out.append({'id':f'{kind}:{code or i}','type':kind,'name':name,'lat':round(lat,7),'lng':round(lng,7),'address':pick(p,'address_tc','address','location'),'phone':pick(p,'phone','tel'),'hours':pick(p,'opening','service_hour','hours'),'detail':pick(p,'floor','detail','remarks'),'source':source})
 if not out:raise ValueError(f'{source}: zero valid points')
 return out

def parse_fehd(raw):
 root=ET.fromstring(raw);out=[]
 for i,node in enumerate(root.iter()):
  vals={c.tag.split('}')[-1].lower():(c.text or '').strip() for c in list(node)}
  typ=' '.join([vals.get('type',''),vals.get('category','')]).lower()
  if not any(x in typ for x in ('toilet','公廁','便所','aqua privy','流動廁所')):continue
  coord=vals.get('map_coordinate','').replace(' ','').split(',')
  try:lat,lng=map(float,coord[:2])
  except:continue
  if not (22<=lat<=23 and 113<=lng<=115):continue
  out.append({'id':f'toilet:{vals.get("id",i)}','type':'toilet','name':vals.get('name_tc') or vals.get('name') or '公廁','lat':round(lat,7),'lng':round(lng,7),'address':vals.get('address_tc') or vals.get('address',''),'phone':vals.get('tel',''),'hours':vals.get('opening_hours_tc') or vals.get('opening_hours',''),'detail':vals.get('remarks_tc') or vals.get('remarks',''),'source':'食環署'})
 if not out:raise ValueError('FEHD: zero toilets; XML schema may have changed')
 return out

def main():
 now=datetime.now(timezone.utc).isoformat();items=[];meta=[]
 for name,kind,url in SOURCES:
  print('Downloading',name,file=sys.stderr);raw=get(url);parsed=parse_geo(raw,kind,name);items+=parsed;meta.append({'name':name,'url':url,'retrievedAt':now,'count':len(parsed)})
 print('Downloading',FEHD[0],file=sys.stderr);raw=get(FEHD[1]);parsed=parse_fehd(raw);items+=parsed;meta.append({'name':FEHD[0],'url':FEHD[1],'retrievedAt':now,'count':len(parsed)})
 db={'version':now[:10],'generatedAt':now,'sources':meta,'items':items};tmp=OUT.with_suffix('.tmp');tmp.write_text(json.dumps(db,ensure_ascii=False,separators=(',',':')),encoding='utf-8');json.loads(tmp.read_text());tmp.replace(OUT);print(f'Wrote {len(items)} facilities to {OUT}')
if __name__=='__main__':main()
