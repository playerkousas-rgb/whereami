import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api/live/traffic': { target: 'https://resource.data.one.gov.hk', changeOrigin: true, rewrite: () => '/td/en/specialtrafficnews.xml' },
      '/api/live/weather': { target: 'https://data.weather.gov.hk', changeOrigin: true, rewrite: () => '/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc' },
      '/api/live/weather-now': { target: 'https://data.weather.gov.hk', changeOrigin: true, rewrite: () => '/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc' },
      '/api/live/trails': { target: 'https://portal.csdi.gov.hk', changeOrigin: true, rewrite: () => '/csdi-webpage/file-api?dataset_id=afcd_rcd_1742550096880_1424&format=geojson&layer_name=CPISDBOCLOSED_TRAIL_IN_CP_GDB' },
      '/api/live/facilities': { target: 'https://portal.csdi.gov.hk', changeOrigin: true, rewrite: () => '/csdi-webpage/file-api?dataset_id=afcd_rcd_1728897009646_22480&format=geojson&layer_name=Closed_Facilities_in_Country_Parks' },
    },
  },
});
