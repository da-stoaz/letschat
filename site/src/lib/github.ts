// Headers for build-time GitHub API calls (version badge, star count).
//
// Unauthenticated GitHub API is 60 req/hr per IP, shared across CI build
// runners — so the version/star fetches intermittently rate-limit and fall back
// to placeholders ("unavailable" / "--"). Set a GITHUB_TOKEN env var in the
// Cloudflare Pages project (Settings → Environment variables) to lift that to
// 5000 req/hr. A classic PAT with no scopes (public read) is enough.
//
// Build/server-time only — never bundled to the client. We read both
// import.meta.env (Vite/.env) and process.env (platform-injected, e.g. the
// Cloudflare Pages build env) so it works however the var is provided.
function readToken(): string | undefined {
  const fromImportMeta = import.meta.env.GITHUB_TOKEN as string | undefined;
  if (fromImportMeta) return fromImportMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.GITHUB_TOKEN;
}

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
