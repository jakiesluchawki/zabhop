import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { startAppUpdateChecks } from "./appUpdate.js";
import "./styles.css";

startAppUpdateChecks();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
