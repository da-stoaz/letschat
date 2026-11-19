import { GITHUB_REPO } from "@/lib/site";

export interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

const KEY = "letschat:latest-release";
const MAX_AGE_MS = 60 * 60 * 1000;

// Browser-side. GitHub allows 60 unauthenticated API requests an hour per IP,
// shared with everything else on that network, so the answer is cached for an
// hour: the home and download pages then cost a visitor one request, not one
// per page view. Returns null when GitHub can't be reached or refuses.
export async function latestRelease(): Promise<Release | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.release;
  } catch {
    // Storage blocked or unreadable: fall through to the network.
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.tag_name !== "string") return null;
    const release: Release = {
      tag_name: data.tag_name,
      assets: (Array.isArray(data.assets) ? data.assets : []).map(
        ({ name, browser_download_url }: Release["assets"][number]) => ({ name, browser_download_url }),
      ),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release }));
    } catch {
      // Not cached; the next page view asks GitHub again.
    }
    return release;
  } catch {
    return null;
  }
}
