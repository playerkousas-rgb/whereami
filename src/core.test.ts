import { describe,expect,it } from 'vitest';
import { convertCoordinates } from './coordinates';
import { bearingDegrees,distanceMeters,nearestFacilities,type FacilityDatabase } from './facilities';
import { MAP_REGIONS,regionUrls } from './offlineMaps';

describe('coordinate conversion',()=>{
 it('converts a Hong Kong WGS84 point to plausible HK1980 and grid references',()=>{const c=convertCoordinates(22.302711,114.177216);expect(c.hkE).toBeGreaterThan(830000);expect(c.hkE).toBeLessThan(850000);expect(c.hkN).toBeGreaterThan(810000);expect(c.hkN).toBeLessThan(830000);expect(c.grid8).toMatch(/^(49|50)Q (GE|HE|JK|KK) \d{4} \d{4}$/)});
 it('selects UTM zones on either side of 114 degrees',()=>{expect(convertCoordinates(22.3,113.99).zone).toBe(49);expect(convertCoordinates(22.3,114.01).zone).toBe(50)});
});
describe('nearby calculations',()=>{
 it('calculates known approximate distance and direction',()=>{const d=distanceMeters(22.3,114.17,22.31,114.17);expect(d).toBeGreaterThan(1100);expect(d).toBeLessThan(1120);expect(bearingDegrees(22.3,114.17,22.31,114.17)).toBeCloseTo(0,5)});
 it('sorts nearest first',()=>{const db:FacilityDatabase={version:'test',generatedAt:null,sources:[],items:[{id:'far',type:'aed',name:'far',lat:22.4,lng:114.17,source:'test'},{id:'near',type:'aed',name:'near',lat:22.301,lng:114.17,source:'test'}]};expect(nearestFacilities(db,22.3,114.17)[0].id).toBe('near')});
});
describe('offline map packages',()=>{it('has non-empty, unique tile URLs for every region',()=>{for(const r of MAP_REGIONS){const urls=regionUrls(r);expect(urls.length).toBeGreaterThan(0);expect(new Set(urls).size).toBe(urls.length)}})});
