import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("一键分发工作台缺少挂载节点");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
