export const GITHUB_OWNER = "da-stoaz";
export const GITHUB_REPO_NAME = "letschat";
export const GITHUB_REPO = `${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;

export const GITHUB_BASE = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_ISSUES = `${GITHUB_BASE}/issues`;
export const GITHUB_ISSUE_NEW = `${GITHUB_BASE}/issues/new/choose`;
export const GITHUB_DISCUSSIONS = `${GITHUB_BASE}/discussions`;
export const GITHUB_RELEASES = `${GITHUB_BASE}/releases`;
export const LICENSE_NAME = "GNU GPLv3";

// Build-time GitHub API reads, shared across every page of one build (and the
// dev server's lifetime). Unauthenticated calls get 60/hour per IP; without
// this the header alone spent one per rendered page. Failures aren't cached.
// Only the fields the site reads: the repo's star count and a release's tag.
type GitHubResponse = { stargazers_count?: number; tag_name?: string } | null;

const githubCache = new Map<string, Promise<GitHubResponse>>();
export function githubApi(path: string): Promise<GitHubResponse> {
  let pending = githubCache.get(path);
  if (!pending) {
    pending = fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => {
        if (data === null) githubCache.delete(path);
        return data;
      });
    githubCache.set(path, pending);
  }
  return pending;
}
