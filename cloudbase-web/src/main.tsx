/// <reference types="vite/client" />

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EventApp from "../../app/EventApp";
import "../../app/globals.css";

window.__POLYWORK_API_URL__ = import.meta.env.VITE_POLYWORK_API_URL;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EventApp mode="participant" />
  </StrictMode>,
);
