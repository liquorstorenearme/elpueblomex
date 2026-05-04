export const config = { runtime: "edge" };

// Returns recent admin commits (chat-driven + form-driven).
// Filters to commits authored by the admin author or messages prefixed with "Admin".

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) return json({ error: "GITHUB_TOKEN missing" }, 500);

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "25")));

  // List recent commits, then filter
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit * 2}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "elpueblomex-admin",
      },
    },
  );
  if (!r.ok) return json({ error: "GitHub list commits failed", status: r.status, detail: await r.text() }, 502);
  const commits: any[] = await r.json();

  const filtered = commits
    .filter((c) => {
      const msg = c.commit?.message || "";
      return /^Admin( chat)?:/i.test(msg) || /^Auto-refresh/.test(msg);
    })
    .slice(0, limit)
    .map((c) => {
      const msg = (c.commit?.message || "").split("\n");
      return {
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        date: c.commit?.author?.date,
        author: c.commit?.author?.name || "unknown",
        title: msg[0] || "",
        body: msg.slice(1).join("\n").trim(),
        url: c.html_url,
      };
    });

  return json({ commits: filtered });
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
