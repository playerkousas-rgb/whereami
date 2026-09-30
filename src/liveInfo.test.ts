// @vitest-environment jsdom
// 端對端測試：以運輸署「特別交通消息（第二代）」官方數據字典（v4.0）的真實 XML 結構，
// 驅動 liveInfo 實際的抓取與解析流程，確保升級第二代直連 API 後解析正確。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAll, type FeedResult } from './liveInfo';

const TD_V2_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<list xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://www.td.gov.hk/tc/special_news/trafficnews.xsd">
  <message>
    <INCIDENT_NUMBER>IN-26-07201</INCIDENT_NUMBER>
    <INCIDENT_HEADING_EN>Road Incident</INCIDENT_HEADING_EN>
    <INCIDENT_HEADING_CN>道路事故</INCIDENT_HEADING_CN>
    <INCIDENT_DETAIL_EN>Traffic Accident</INCIDENT_DETAIL_EN>
    <INCIDENT_DETAIL_CN>交通意外</INCIDENT_DETAIL_CN>
    <LOCATION_EN>Castle Peak Road - Yuen Long</LOCATION_EN>
    <LOCATION_CN>青山公路　–　元朗段</LOCATION_CN>
    <DISTRICT_EN>Yuen Long</DISTRICT_EN>
    <DISTRICT_CN>元朗</DISTRICT_CN>
    <DIRECTION_EN>Au Tau</DIRECTION_EN>
    <DIRECTION_CN>凹頭</DIRECTION_CN>
    <ANNOUNCEMENT_DATE>2026-09-30T19:15:00</ANNOUNCEMENT_DATE>
    <INCIDENT_STATUS_EN>NEW</INCIDENT_STATUS_EN>
    <INCIDENT_STATUS_CN>最新情況</INCIDENT_STATUS_CN>
    <NEAR_LANDMARK_EN>Long Yat Road</NEAR_LANDMARK_EN>
    <NEAR_LANDMARK_CN>朗日路</NEAR_LANDMARK_CN>
    <BETWEEN_LANDMARK_EN/>
    <BETWEEN_LANDMARK_CN/>
    <ID>147121</ID>
    <CONTENT_EN>Due to traffic accident , the fast lane of Castle Peak Road - Yuen Long (Au Tau bound) near Long Yat Road is closed to all traffic.</CONTENT_EN>
    <CONTENT_CN>因交通意外，青山公路　–　元朗段(往凹頭方向)近朗日路的快線現已封閉。 現時上址交通繁忙。</CONTENT_CN>
    <LATITUDE>22.443271</LATITUDE>
    <LONGITUDE>114.017438</LONGITUDE>
  </message>
  <message>
    <INCIDENT_NUMBER>IN-26-07188</INCIDENT_NUMBER>
    <INCIDENT_HEADING_EN>Road Incident</INCIDENT_HEADING_EN>
    <INCIDENT_HEADING_CN>道路事故</INCIDENT_HEADING_CN>
    <INCIDENT_DETAIL_EN>Vehicle Breakdown</INCIDENT_DETAIL_EN>
    <INCIDENT_DETAIL_CN>車輛故障</INCIDENT_DETAIL_CN>
    <LOCATION_EN>Lung Cheung Road</LOCATION_EN>
    <LOCATION_CN>龍翔道</LOCATION_CN>
    <DISTRICT_EN>Wong Tai Sin</DISTRICT_EN>
    <DISTRICT_CN>黃大仙</DISTRICT_CN>
    <DIRECTION_EN>Tsuen Wan</DIRECTION_EN>
    <DIRECTION_CN>荃灣</DIRECTION_CN>
    <ANNOUNCEMENT_DATE>2026-09-30T18:40:00</ANNOUNCEMENT_DATE>
    <INCIDENT_STATUS_EN>CLOSED</INCIDENT_STATUS_EN>
    <INCIDENT_STATUS_CN>完結</INCIDENT_STATUS_CN>
    <NEAR_LANDMARK_EN>Tin Ma Court</NEAR_LANDMARK_EN>
    <NEAR_LANDMARK_CN>天馬苑</NEAR_LANDMARK_CN>
    <BETWEEN_LANDMARK_EN/>
    <BETWEEN_LANDMARK_CN/>
    <ID>147098</ID>
    <CONTENT_EN>The slow lane of Lung Cheung Road (Tsuen Wan bound) near Tin Ma Court which was closed due to vehicle breakdown is re-opened to all traffic.</CONTENT_EN>
    <CONTENT_CN>較早前因車輛故障而封閉的龍翔道(往荃灣方向)近天馬苑的慢線現已解封。</CONTENT_CN>
    <LATITUDE/>
    <LONGITUDE/>
  </message>
</list>`;

describe('transport department special traffic news (2nd generation) parsing', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('parses TD v2 XML: title, district, landmark, content, ISO time, coordinates and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/live/traffic')) return new Response(TD_V2_SAMPLE, { status: 200, headers: { 'content-type': 'text/xml' } });
      throw new Error('network unavailable in test');
    }));
    const results: FeedResult[] = [];
    await refreshAll(r => { results.push(r); });
    const traffic = results.find(r => r.id === 'traffic');
    expect(traffic).toBeDefined();
    expect(traffic?.state).toBe('fresh');
    expect(traffic?.count).toBe(2);
    const items = traffic?.items || [];
    // 依官方 ANNOUNCEMENT_DATE（ISO，可解析）由新至舊排序
    expect(items[0].publishedAt).toBe('2026-09-30T19:15:00');
    expect(items[0].title).toContain('青山公路');
    expect(items[0].title).toContain('道路事故：交通意外');
    expect(items[0].title).toContain('往凹頭方向');
    // 第二代新增：區份、地標、完整內容、座標、狀態
    expect(items[0].detail).toContain('元朗');
    expect(items[0].detail).toContain('近朗日路');
    expect(items[0].detail).toContain('快線現已封閉');
    expect(items[0].lat).toBeCloseTo(22.443271, 6);
    expect(items[0].lng).toBeCloseTo(114.017438, 6);
    expect(items[0].statusBadge).toBe('最新情況');
    // 完結個案：狀態完結、無座標不應虛構
    expect(items[1].statusBadge).toBe('完結');
    expect(items[1].lat).toBeUndefined();
    expect(items[1].detail).toContain('現已解封');
  });

  it('keeps official English statuses mapped to Chinese badges when CN field is absent', async () => {
    const xml = TD_V2_SAMPLE
      .replace(/<INCIDENT_STATUS_CN>[^<]*<\/INCIDENT_STATUS_CN>/g, '')
      .replace(/<DISTRICT_CN>[^<]*<\/DISTRICT_CN>/g, '');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/live/traffic')) return new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
      throw new Error('network unavailable in test');
    }));
    const results: FeedResult[] = [];
    await refreshAll(r => { results.push(r); });
    const traffic = results.find(r => r.id === 'traffic');
    expect(traffic?.state).toBe('fresh');
    const items = traffic?.items || [];
    expect(items[0].statusBadge).toBe('最新情況'); // NEW → 最新情況
    expect(items[1].statusBadge).toBe('完結'); // CLOSED → 完結
    // 沒有 DISTRICT_CN 時退回英文區份，而非整欄消失
    expect(items[0].detail).toContain('Yuen Long');
  });
});
