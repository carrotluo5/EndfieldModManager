import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../styles/global.css";
import { SidePanelApp } from "./SidePanelApp";

document.documentElement.classList.add("transparent-window");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>
);
