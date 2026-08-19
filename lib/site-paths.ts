export function sitePath(path: string) {
  if (typeof window === "undefined") return path;
  const base = window.__POLYWORK_BASE_URL__ || "/";
  if (base === "/") return path;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}${path === "/" ? "/" : path}`;
}
