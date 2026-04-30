export const config = { runtime: "edge" };

const ALLOWED = new Set(["site", "locations", "posts", "press", "jobs", "menu", "instagram"]);

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const file = (url.searchParams.get("file") || "site").toLowerCase();
  if (!ALLOWED.has(file)) {
    return new Response(JSON.stringify({ error: "Invalid file" }), { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const path = `content/${file}.json`;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token) return new Response(JSON.stringify({ error: "GITHUB_TOKEN missing" }), { status: 500 });

  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "elpueblomex-admin",
      },
    },
  );
  if (!r.ok) {
    const text = await r.text();
    return new Response(JSON.stringify({ error: "GitHub fetch failed", status: r.status, detail: text }), { status: 502 });
  }
  const data: any = await r.json();
  const decoded = atob(data.content.replace(/\n/g, ""));
  const content = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0))));

  return new Response(JSON.stringify({ file, sha: data.sha, content }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
