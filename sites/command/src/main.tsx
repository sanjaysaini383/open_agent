import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";
import { startApp } from "./lib/boot";

// Hash routing: every page is the same static file, so any static host serves the app
// without rewrite rules, at a domain root or under a subpath.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

void startApp();
