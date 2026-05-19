import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

import { cloudflare } from "@cloudflare/vite-plugin";

const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [...(useHttps ? [basicSsl()] : []), cloudflare()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5174,
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4174,
  },
});