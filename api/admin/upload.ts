export const config = { runtime: "edge" };

const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function slugify(s: string): string {
  return (s || "upload")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "upload";
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  const authorName = process.env.GITHUB_AUTHOR_NAME || "El Pueblo Admin";
  const authorEmail = process.env.GITHUB_AUTHOR_EMAIL || "admin@elpueblomex.com";

  if (!token) return new Response(JSON.stringify({ error: "GITHUB_TOKEN missing" }), { status: 500 });

  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) return new Response(JSON.stringify({ error: "No file" }), { status: 400 });
  if (f.size > MAX_BYTES) return new Response(JSON.stringify({ error: "File too large (8MB max)" }), { status: 413 });

  const ext = EXT[f.type];
  if (!ext) return new Response(JSON.stringify({ error: "Unsupported type; JPEG/PNG/WebP/GIF only" }), { status: 400 });

  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin);

  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const base = slugify(f.name);
  const filename = `${ts}-${base}.${ext}`;
  const path = `public/images/uploads/${filename}`;
  const publicUrl = `/images/uploads/${filename}`;

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
        message: `Admin: upload ${filename}`,
        content: b64,
        branch,
        committer: { name: authorName, email: authorEmail },
        author: { name: authorName, email: authorEmail },
      }),
    },
  );

  if (!put.ok) {
    const detail = await put.text();
    return new Response(JSON.stringify({ error: "Upload failed", status: put.status, detail }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true, url: publicUrl, filename }), {
    headers: { "Content-Type": "application/json" },
  });
}
