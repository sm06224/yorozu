/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages はサブパス配信 (https://<user>.github.io/yorozu/) のため、
// CI から BASE_PATH=/yorozu/ を注入する。ローカルは "/"。
const base = process.env.BASE_PATH ?? "/";

// 設計書 §5/§9: 厳格CSP・外部スクリプト0がリリース条件。
// dev では HMR がインラインスクリプトを使うため本番ビルドのみに注入する。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: は添付画像のローカル object URL 表示用 (#25)。外部読み込みは増えない
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // OneDrive のファイル内容 GET は 302 でダウンロード専用ドメインへ飛ぶ (Graph 仕様)。
  // リダイレクト先も connect-src の検査対象なので、個人用 OneDrive の
  // ダウンロードホストを許可する (XHR先が増えるだけで script-src は不変)
  // www.googleapis.com は Drive/Calendar/Tasks API (認可画面はナビゲーションなので不要)
  "connect-src 'self' https://api.anthropic.com https://graph.microsoft.com https://login.microsoftonline.com https://my.microsoftpersonalcontent.com https://*.storage.live.com https://*.1drv.com https://www.googleapis.com",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig(({ command }) => ({
  base,
  plugins: [
    react(),
    {
      name: "inject-csp",
      transformIndexHtml(html: string) {
        if (command !== "build") return html;
        return html.replace(
          "<meta charset",
          `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta charset`,
        );
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "YOROZU",
        short_name: "YOROZU",
        description: "単人・ゼロランニングコストのPIM",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
