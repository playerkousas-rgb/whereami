# 政府部門 API 審計報告

**審計日期：2026-09-30（所有「即時測試」結果均於當日實際呼叫該 API 取得）**

## 目的

逐一核對 App 現時使用的每一個政府 API，按**負責部門**比對：

1. API 是否仍然有效（實際呼叫驗證，而非只看文件）；
2. 部門是否已改用／新增**新一代 API**，令 App 仍在讀舊入口；
3. 內置資料庫（`public/data/facilities.json`、燈柱分區）的記錄數與官方目前發布的是否一致；
4. 資料新鮮度——官方最新更新時間為何。

## 總結（先講結論）

| # | 部門 | 資料 | App 現用入口 | 審計結果 | 動作 |
|---|------|------|--------------|----------|------|
| 1 | 運輸署 | 特別交通消息 | `resource.data.one.gov.hk`（舊「資料一線通」第一代） | ⚠️ **已換新**：官方已推出「第二代」，直接由 `td.gov.hk` 發布，並新增座標、區份、ISO 時間、事故狀態；舊版只是「直至另行通知」繼續提供 | **已改用第二代直連 API** |
| 2 | 香港天文台 | 現在天氣／天氣警告 | `data.weather.gov.hk`（天文台自家開放數據 API） | ✅ 現行有效（說明書 v1.13，2025-09）；即時測試回傳當日 19:02 資料 | 無需改動（可日後加 `warningInfo`/`swt`） |
| 3 | 漁農自然護理署 | 封閉山徑 | CSDI `afcd_rcd_1742550096880_1424` | ✅ 現時 7 筆封閉記錄，服務有效 | 無需改動；已改善解析器 |
| 4 | 漁農自然護理署 | 關閉郊野設施 | CSDI `afcd_rcd_1728897009646_22480` | ✅ 現時 19 筆 | 無需改動；已改善解析器 |
| 5 | 漁農自然護理署 | 標距柱 | CSDI `afcd_rcd_1635136039113_86105` | ✅ 1,078 支，與內置完全一致 | 無需改動 |
| 6 | 漁農自然護理署 | 郊野加水站 | CSDI `afcd_rcd_1635133835075_48993` | ✅ 37 個，與內置完全一致 | 無需改動 |
| 7 | 消防處 | AED（CARE 中央註冊庫） | CSDI `hkfsd_rcd_1695974242578_37917` | ✅ 4,189 部，與內置完全一致 | 無需改動 |
| 8 | 消防處 | 消防局 | CSDI ArcGIS `hkfsd_rcd_1634798867463_89696` | ✅ 95 間，與內置完全一致 | 無需改動 |
| 9 | 消防處 | 救護站 | CSDI ArcGIS `hkfsd_rcd_1634799003993_7633` | ✅ 45 個，與內置完全一致 | 無需改動 |
| 10 | 醫務衞生局（前食物及衞生局） | 急症室 | CSDI `fhb_rcd_1636947932221_94410` | ✅ 18 間，與內置一致；局方 2022 年重組（FHB→HHB），數據集編號沿用 `fhb_` 前綴但服務有效 | 無需改動 |
| 11 | 香港警務處 | 警署 | CSDI `police_rcd_1639562064290_95464` | ✅ 40 間，與內置完全一致 | 無需改動 |
| 12 | 路政署 | 燈柱 | CSDI `hyd_rcd_1629267205229_84645` | ✅ 144,873 支，與建置腳本門檻一致；ArcGIS 服務（"Lamp Post Location Data"）運作中 | 無需改動 |
| 13 | 食物環境衞生署 | 公廁 | `fehd.gov.hk` 部門自家 XML | ✅ 有效，內含 2026 年 1 月更新的記錄 | 無需改動 |

**結論：唯一真正「已換 API」的是運輸署交通消息，本次已切換。** 其餘入口全部仍然有效且數量一致。CSDI（空間數據共享平台）並非舊式合集，而是發展局的現行官方空間數據平台；天文台與食環署本来就是部門自家網域。

---

## 逐部門詳細比對

### 1. 運輸署 · 特別交通消息（唯一需要更換的 API）

**舊入口（App 原用）：**
```text
https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml
```

- 即時測試：仍回傳 XML，含 2026-09-30 19:09 消息——**尚未關閉**；
- 但 `resource.data.one.gov.hk` 是 2011 年「資料一線通 Data.One」年代的舊聚合網域；data.gov.hk 數據集頁面明言：*「此主頁會繼續提供『特別交通消息』數據集，直至另行通知」*——即**維護模式，隨時可停**；
- 舊版欄位貧乏：只有編號、中／英長短文字、非 ISO 日期（`2026/9/30 下午 07:09:51`，`Date.parse` 無法排序），**沒有座標、沒有區份、沒有狀態**。

**官方新一代（第二代，2026-09-30 實測有效）：**
```text
https://www.td.gov.hk/tc/special_news/trafficnews.xml
```

- 直接由運輸署自家網域發布（繁體中文版檔案同時含中英欄位）；
- 數據字典 v4.0（2019-11）欄位：`INCIDENT_NUMBER`、`INCIDENT_HEADING_CN`、`INCIDENT_DETAIL_CN`（事故性質）、`LOCATION_CN`、`DISTRICT_CN`（十八區）、`DIRECTION_CN`、`NEAR_LANDMARK_CN`、`BETWEEN_LANDMARK_CN`、`ANNOUNCEMENT_DATE`（**ISO 8601**）、`INCIDENT_STATUS_CN`（最新情況／更新情況／完結）、`CONTENT_CN`（完整內容）、`LATITUDE`／`LONGITUDE`（**WGS-84 座標，可選**）。

**已實施的修改：**

| 檔案 | 修改 |
|---|---|
| `vite.config.ts` | proxy 目標改為 `https://www.td.gov.hk/tc/special_news/trafficnews.xml` |
| `vercel.json` | rewrite 目標同步更改 |
| `src/liveInfo.ts` | XML 解析器升級：`CONTENT_CN` 作詳細內容（`INCIDENT_DETAIL_CN` 只是事故性質）、`ANNOUNCEMENT_DATE` 作官方時間（可排序）、`INCIDENT_STATUS_CN` 作狀態標籤、`DISTRICT_CN`／`NEAR_LANDMARK_CN` 併入內容、`LATITUDE`／`LONGITUDE` 帶入 `lat`／`lng`（App 一向只在有可靠座標時才計「附近」，現在官方終於提供）；舊版欄位（`ChinText`、`reference_date` 等）保留為後備 |
| `src/main.tsx` | 狀態「完結」視同已完結事件（藍色標籤），不再誤標「封閉」 |

### 2. 香港天文台 · 天氣（現行，無需改動）

```text
https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc
https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc
```

- 這是天文台**自家**開放數據 API（`data.weather.gov.hk` 為天文台網域），不是第三方合集；
- 即時測試：`rhrread` 回傳 `updateTime: 2026-09-30T19:02:00+08:00`；`warnsum` 回傳酷熱天氣警告（更新於 16:20）——兩者皆為當日資料；
- 官方說明書現行版本為 **v1.13（2025 年 9 月）**，`rhrread`／`warnsum` 仍是正式支援的 dataType；
- 說明書另提供較新的 `warningInfo`（個別警告詳情）及 `swt`（特別天氣提示）端點；App 現時從 `rhrread.warningMessage` 取得特別提示，功能重疊，可日後按需要改用專用端點。

### 3–6. 漁農自然護理署（AFCD）· 經 CSDI（現行，無需改動）

App 透過 CSDI 空間數據共享平台（`portal.csdi.gov.hk`）取用 4 個漁護署數據集。**CSDI 是發展局推出的現行官方空間數據平台**，不是舊資料合集；dataset_id 未變。即時測試（經 CSDI ArcGIS REST 服務 `returnCountOnly` 查詢）：

| 數據集 | dataset_id | 官方現時筆數 | 內置版本筆數 | 一致 |
|---|---|---|---|---|
| 封閉山徑 | `afcd_rcd_1742550096880_1424` | 7 | （即時訊息，不內置） | ✅ |
| 關閉郊野設施 | `afcd_rcd_1728897009646_22480` | 19 | （即時訊息，不內置） | ✅ |
| 標距柱 | `afcd_rcd_1635136039113_86105` | 1,078 | 1,078 | ✅ |
| 郊野加水站 | `afcd_rcd_1635133835075_48993` | 37 | 37 | ✅ |

實測欄位（封閉山徑）：`TRAIL_NAME_TC`、`LOCATION_TC`、`STATUS_TC`、`EFFECTIVE_DATE`（epoch 毫秒）、`EXPECTED_EXPIRY_DATE`。

**「舊資料」的真相**：此數據集內有 `EFFECTIVE_DATE` 為 **2013-03-15** 的記錄（例如鳳凰徑第七段部分暫時改道），狀態為「直至另行通知」——這不是 API 廢棄，而是**官方仍生效的長期封閉**。App 有責任如實顯示官方日期讓使用者自行判斷；本次已把 epoch 毫秒轉成可讀的 HKT 日期（原先會顯示 `1363276800000` 這類原始數字），並把 `EXPECTED_EXPIRY_DATE: "Until further notice"` 譯成「直至另行通知」，以及把 `LOCATION_TC`（郊野公園名）併入標題（例如「八仙嶺郊野公園 · 洗手間」，原先只顯示「洗手間」）。

### 7–9. 消防處（FSD）· 經 CSDI（現行，無需改動）

| 數據集 | 服務 | 官方現時筆數 | 內置版本筆數 | 一致 |
|---|---|---|---|---|
| AED（CARE 中央註冊庫） | `hkfsd_rcd_1695974242578_37917` | 4,189 | 4,189 | ✅ |
| 消防局 | `hkfsd_rcd_1634798867463_89696`（ArcGIS FeatureServer） | 95 | 95 | ✅ |
| 救護站 | `hkfsd_rcd_1634799003993_7633`（ArcGIS FeatureServer） | 45 | 45 | ✅ |

AED 數據集官方名稱為 "Automated External Defibrillators (AEDs) in Centralised AED Registry for Emergency (CARE)"，ArcGIS 服務（v10.91）運作正常。

### 10. 醫務衞生局（前食物及衞生局）· 急症室（現行，無需改動）

- 數據集編號 `fhb_rcd_1636947932221_94410` 的 `fhb` 前綴來自已重組的**食物及衞生局**（2022 年改組為醫務衞生局）；
- 編號雖舊，服務完全有效：即時測試 18 間公營急症室，與內置 18 筆一致；
- 若部門日後以新局方名義重發數據集，dataset_id 可能改變——建議每次建置時靠 `build_facilities.py` 的「零記錄即失敗」機制把關（已內建）。

### 11. 香港警務處 · 警署（現行，無需改動）

- CSDI `police_rcd_1639562064290_95464`（geotagging）：即時測試 40 間，與內置 40 筆一致。

### 12. 路政署 · 燈柱（現行，無需改動）

- CSDI `hyd_rcd_1629267205229_84645`（"Lamp Post Location Data"，`hyd` = 路政署）；
- 即時測試：144,873 支，與 `build_lampposts.py` 的 100,000 支門檻及歷史建置一致；
- ArcGIS 服務 v10.91、WGS84、`maxRecordCount=3000`；App 用 file-api 全檔下載再分區，不受分頁限制。

### 13. 食物環境衞生署 · 公廁（現行，無需改動）

```text
https://www.fehd.gov.hk/tc_chi/map/fehd_map_c.xml
```

- 部門**自家網域**的 XML（非合集）；即時測試有效，檔案含 2026-01-27、2025-12-23 等更新記錄，亦有「暫停服務日期: 2024年3月6日至2026年12月2日」等如實標註的長期停用設施；
- 欄位與食環署官方數據字典（`mapID, map_type, name_c, address_c, openHr_c, map_coordinate, updateDate, remarks_c`）一致。

### 僅記錄在 readme、未實作的 API（一併核對）

| API | 狀態 |
|---|---|
| 地政總署地點搜尋 `geodata.gov.hk/gs/api/v1.0.0/locationSearch` | ⚠️ 從本審計環境（海外）無法連上；readme 已註明「可能限制部分海外伺服器」，產品須設後備來源。未實作，暫無影響 |
| 地址查詢 ALS `www.als.gov.hk/lookup` | 未實作；實作前須再實測 |
| OpenTopoData | 第三方（非政府），未實作 |

---

## 資料一致性驗證方法（可重複）

內置資料筆數以 `public/data/facilities.json` 的 `sources[].count` 為準；官方現時筆數以 CSDI ArcGIS REST 即時查詢：

```text
https://portal.csdi.gov.hk/server/rest/services/common/{dataset_id}/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json
```

`scripts/build_facilities.py` 及 GitHub Actions（每週一 19:23 UTC）會在官方數據集失效或回零時**拒絕輸出**，因此內置資料不會無聲地變成舊檔。

## 建議的後續監察

1. **每季重跑本審計**：各 `returnCountOnly` 查詢 + 交通／天氣即時端點抽測（本報告「總結」表即核對清單）；
2. 運輸署舊入口（`resource.data.one.gov.hk`）一旦回 404／410，對 App 已無影響（已切直連）；
3. 留意 CSDI dataset_id 變動（尤其 `fhb_` 前綴的急症室數據集）；
4. 天文台說明書更新時考慮改用 `swt` 專用端點取特別天氣提示。
