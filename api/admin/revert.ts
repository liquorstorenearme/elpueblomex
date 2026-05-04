export const config = { runtime: "edge" };

// Reverts a previously-applied commit by restoring each changed content/*.json file
// to the parent commit's content. We don't use `git revert` on GitHub (no clean way via
// REST Contents API) — instead we PUT each file back to its pre-commit contents.

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  const authorName = process.env.GITHUB_AUTHOR_NAME || "El Pueblo Admin";
  const authorEmail = process.env.GITHUB_AUTHOR_EMAIL || "admin@elpueblomex.com";
  if (!token) return json({ error: "GITHUB_TOKEN missing" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const sha: string = String(body.sha || "");
  if (!/^[a-f0-9]{7,40}$/.test(sha)) return json({ error: "Invalid sha" }, 400);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "elpueblomex-admin",
  };

  // Get the commit details (to find files changed and parent SHA)
  const cr = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers });
  if (!cr.ok) return json({ error: "Commit not found", detail: await cr.text() }, 404);
  const commit: any = await cr.json();
  const parentSha = commit.parents?.[0]?.sha;
  if (!parentSha) return json({ error: "No parent commit (root) — cannot revert" }, 400);
  const files: any[] = (commit.files || []).filter((f: any) => /^content\/.+\.json$/.test(f.filename));
  if (!files.length) return json({ error: "No content/*.json files in this commit to revert" }, 400);

  const restored: any[] = [];
  for (const f of files) {
    // Get parent version of the file
    const parentR = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${f.filename}?ref=${parentSha}`,
      { headers },
    );
    let parentContent: string;
    let mode: "replace" | "delete" = "replace";
    if (parentR.status === 404) {
      // File didn't exist in parent — was created by this commit. Delete it on revert.
      mode = "delete";
      parentContent = "";
    } else if (!parentR.ok) {
      return json({ error: `Failed to fetch parent for ${f.filename}`, detail: await parentR.text() }, 502);
    } else {
      const pd: any = await parentR.json();
      parentContent = pd.content; // already base64
    }

    // Get current SHA of the file at HEAD
    const headR = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${f.filename}?ref=${branch}`,
      { headers },
    );
    if (!headR.ok && headR.status !== 404) {
      return json({ error: `Failed to fetch HEAD for ${f.filename}`, detail: await headR.text() }, 502);
    }
    const headData: any = headR.ok ? await headR.json() : null;

    if (mode === "delete") {
      if (!headData) continue; // already gone
      const delR = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.filename}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Revert: remove ${f.filename} (was added in ${sha.slice(0, 7)})`,
          sha: headData.sha,
          branch,
          committer: { name: authorName, email: authorEmail },
          author: { name: authorName, email: authorEmail },
        }),
      });
      if (!delR.ok) return json({ error: `Delete ${f.filename} failed`, detail: await delR.text() }, 502);
      restored.push({ file: f.filename, action: "deleted" });
    } else {
      const putR = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.filename}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Admin revert: restore ${f.filename} to pre-${sha.slice(0, 7)} state`,
          content: parentContent,
          sha: headData?.sha,
          branch,
          committer: { name: authorName, email: authorEmail },
          author: { name: authorName, email: authorEmail },
        }),
      });
      if (!putR.ok) return json({ error: `Restore ${f.filename} failed`, detail: await putR.text() }, 502);
      restored.push({ file: f.filename, action: "restored" });
    }
  }

  return json({ ok: true, revertedSha: sha, restored });
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
