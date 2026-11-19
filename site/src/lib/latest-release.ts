// Relative, not "@/lib/site": the root unit tests import this file directly.
import { GITHUB_RELEASES, GITHUB_REPO, type ReleaseAsset } from "./site";

export interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

// One download button per installer. The pattern picks its file in a release.
export const FORMATS = {
  "mac": /\.dmg$/i,
  "windows-x64-msi": /^(?!.*(?:aarch64|arm64)).*\.msi$/i,
  "windows-x64-exe": /^(?!.*(?:aarch64|arm64)).*\.exe$/i,
  "windows-arm-msi": /(?:aarch64|arm64).*\.msi$/i,
  "windows-arm-exe": /(?:aarch64|arm64).*\.exe$/i,
  "linux-deb": /\.deb$/i,
  "linux-appimage": /\.AppImage$/i,
} satisfies Record<string, RegExp>;

export type Format = keyof typeof FORMATS;

// The file for one button, or the release page when GitHub's answer is
// missing or has no such file. Never an empty or dead link.
export function downloadUrl(release: { assets?: ReleaseAsset[] } | null, format: Format): string {
  return release?.assets?.find((asset) => FORMATS[format].test(asset.name))?.browser_download_url
    ?? `${GITHUB_RELEASES}/latest`;
}

const KEY = "letschat:latest-release";
const MAX_AGE_MS = 60 * 60 * 1000;

// Keeps only well-formed fields, so neither an odd API answer nor an old
// cache entry can break a page.
function toRelease(data: unknown): Release | null {
  const { tag_name, assets } = (data ?? {}) as Partial<Release>;
  if (typeof tag_name !== "string" || !Array.isArray(assets)) return null;
  return {
    tag_name,
    assets: assets
      .filter((asset) => typeof asset?.name === "string" && typeof asset.browser_download_url === "string")
      .map(({ name, browser_download_url }) => ({ name, browser_download_url })),
  };
}

// Browser-side check for a release newer than the one the page was built with.
// Pages must already work without it: it resolves null on any failure and may
// never resolve at all if GitHub stalls. GitHub allows 60 unauthenticated
// requests an hour per IP, so the answer is cached for an hour.
export async function latestRelease(): Promise<Release | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const release = Date.now() - cached?.at < MAX_AGE_MS ? toRelease(cached.release) : null;
    if (release) return release;
  } catch {
    // Storage blocked or unreadable: ask GitHub.
  }
  const release = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((res) => (res.ok ? res.json() : null))
    .then(toRelease, () => null);
  try {
    if (release) localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release }));
  } catch {
    // Not cached: the next page view asks again.
  }
  return release;
}
