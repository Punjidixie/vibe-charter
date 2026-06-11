// Resolve a public-folder asset path under Vite's configured `base`.
// Works in dev (BASE_URL = "/") and under GitHub Pages (BASE_URL = "/vibe-charter/").
export function assetUrl(path: string): string {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${import.meta.env.BASE_URL}${trimmed}`;
}
