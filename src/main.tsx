import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installGlobalErrorLog } from "./debug/log";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./index.css";

installGlobalErrorLog();

// Google OAuth リダイレクト戻り (#access_token=...) はレンダリング前に処理して
// URL からトークンを消す (MSAL の ?code= 戻りは App 側で処理)
if (window.location.hash.includes("access_token=")) {
  void import("./google/auth").then((m) => m.gHandleRedirect());
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
