export const config = { runtime: "edge" };

const ALLOWED = new Set(["site", "locations", "posts"]);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  const authorName = process.env.GITHUB_AUTHOR_NAME || "El Pueblo Admin";
  const authorEmail = process.env.GITHUB_AUTHOR_EMAIL || "admin@elpueblomex.com";

  if (!token) return new Response(JSON.stringify({ error: "GITHUB_TOKEN missing" }), { status: 500 });

  let body: { file: string; content: any; sha?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const file = (body.file || "").toLowerCase();
  if (!ALLOWED.has(file)) {
    return new Response(JSON.stringify({ error: "Invalid file" }), { status: 400 });
  }
  if (!body.content || typeof body.content !== "object") {
    return new Response(JSON.stringify({ error: "Missing content" }), { status: 400 });
  }

  const path = `content/${file}.json`;

  let sha = body.sha;
  if (!sha) {
    const cur = await fetch(
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
    if (cur.ok) {
      const d: any = await cur.json();
      sha = d.sha;
    }
  }

  const json = JSON.stringify(body.content, null, 2) + "\n";
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);

  const commitMsg = body.message || `Admin: update ${file}.json — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  const put = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "elpueblomex-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: commitMsg,
        content: b64,
        sha,
        branch,
        committer: { name: authorName, email: authorEmail },
        author: { name: authorName, email: authorEmail },
      }),
    },
  );

  if (!put.ok) {
    const detail = await put.text();
    return new Response(JSON.stringify({ error: "GitHub write failed", status: put.status, detail }), { status: 502 });
  }
  const result: any = await put.json();
  return new Response(JSON.stringify({
    ok: true,
    sha: result.content?.sha,
    commit: result.commit?.sha,
    url: result.commit?.html_url,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
