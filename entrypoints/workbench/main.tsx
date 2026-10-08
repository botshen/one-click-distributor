import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("一键分发工作台缺少挂载节点");

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const applySystemTheme = () => {
  document.documentElement.classList.toggle("dark", systemTheme.matches);
};
applySystemTheme();
systemTheme.addEventListener("change", applySystemTheme);
import.meta.hot?.dispose(() => systemTheme.removeEventListener("change", applySystemTheme));

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
