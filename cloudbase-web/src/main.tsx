/// <reference types="vite/client" />

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ArchiveApp from "../../app/ArchiveApp";
import EventApp from "../../app/EventApp";
import "../../app/globals.css";

window.__POLYWORK_API_URL__ = import.meta.env.VITE_POLYWORK_API_URL;
window.__POLYWORK_STATIC_DATA_URL__ = `${import.meta.env.BASE_URL}polywork-events.json`;
window.__POLYWORK_BASE_URL__ = import.meta.env.BASE_URL;

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const pathname = window.location.pathname.replace(/\/$/, "");
  const route = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  if (route === "/archive") return <ArchiveApp />;
  if (route === "/host") return <EventApp mode="host" />;
  if (route === "/join") return <EventApp mode="participant" />;
  return <EventApp mode="landing" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
