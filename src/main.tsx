import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installGlobalErrorLog } from "./debug/log";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./index.css";

installGlobalErrorLog();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
