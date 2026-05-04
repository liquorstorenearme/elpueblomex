export const config = { runtime: "edge" };

// AI chat assistant for the admin panel.
// Two-phase flow:
//   1) /api/admin/chat (POST) with { messages, history } -> calls Anthropic with tools.
//      For READ tools: auto-execute, feed result back to model, recurse.
//      For WRITE tools: pause, return { pending: { toolUseId, toolName, input, preview } }.
//   2) UI shows preview to user; on Confirm, POSTs same messages + { confirmToolUseId, toolInput }.
//      Server applies the change via GitHub Contents API (same path as save.ts), then feeds
//      the tool_result back to the model so it produces a friendly natural-language confirmation.
//
// Tools are strict — they only mutate fields in an allowlist. The model can NEVER write raw JSON.

const MODEL = "claude-sonnet-4-5";
const MAX_TURNS = 8; // total assistant turns per request, prevents runaway tool loops

const ROLE_RANK: Record<string, number> = { read_only: 1, manager: 2, owner: 3 };
function getCookieRole(req: Request): { email: string; role: string } {
  const cookies = req.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)ep_admin=([^;]+)/);
  if (!m) return { email: "", role: "" };
  try {
    const payload = JSON.parse(atob(m[1].split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return { email: payload.email || "owner", role: payload.role || "owner" };
  } catch { return { email: "", role: "" }; }
}

// ---------- GitHub helpers (read/write content/*.json) ----------

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "elpueblomex-admin",
  };
}

async function ghLoad(file: string): Promise<{ content: any; sha: string }> {
  const token = process.env.GITHUB_TOKEN!;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  const path = `content/${file}.json`;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: ghHeaders(token) },
  );
  if (!r.ok) throw new Error(`GitHub load ${file} failed: ${r.status}`);
  const data: any = await r.json();
  const decoded = atob(data.content.replace(/\n/g, ""));
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0))));
  return { content: json, sha: data.sha };
}

async function ghSave(file: string, content: any, sha: string, message: string): Promise<{ commitSha: string; url: string }> {
  const token = process.env.GITHUB_TOKEN!;
  const owner = process.env.GITHUB_OWNER || "liquorstorenearme";
  const repo = process.env.GITHUB_REPO || "elpueblomex";
  const branch = process.env.GITHUB_BRANCH || "main";
  const authorName = process.env.GITHUB_AUTHOR_NAME || "El Pueblo Admin";
  const authorEmail = process.env.GITHUB_AUTHOR_EMAIL || "admin@elpueblomex.com";
  const path = `content/${file}.json`;
  const json = JSON.stringify(content, null, 2) + "\n";
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: b64,
      sha,
      branch,
      committer: { name: authorName, email: authorEmail },
      author: { name: authorName, email: authorEmail },
    }),
  });
  if (!r.ok) throw new Error(`GitHub save ${file} failed: ${r.status} ${await r.text()}`);
  const result: any = await r.json();
  return { commitSha: result.commit?.sha, url: result.commit?.html_url };
}

// ---------- Tool definitions ----------

type ToolKind = "read" | "write";
type ToolHandlerInput = Record<string, any>;

interface ToolHandlerResult {
  /** Human summary of what the tool did/will do. */
  summary: string;
  /** For write tools: the file to modify. */
  file?: string;
  /** For write tools: the new content of the entire file. */
  newContent?: any;
  /** Optional small preview (subset of before/after for the diff card). */
  preview?: { path: string; before: any; after: any };
  /** For read tools: the data to return to the model. */
  data?: any;
}

interface ToolDef {
  name: string;
  description: string;
  kind: ToolKind;
  input_schema: any;
  handler: (input: ToolHandlerInput) => Promise<ToolHandlerResult>;
}

// --- Site.json allowlisted paths for setSiteField ---
// Restrict to safe non-hero copy. Forbid touching hero copy (brand-critical),
// SEO config, GA4, and structural settings.
const SITE_FIELD_ALLOWLIST = new Set([
  "brand.name",
  "brand.tagline",
  "brand.email",
  "givesBack.disclaimer",
]);

const LOCATION_FIELD_ALLOWLIST = new Set([
  "phone",
  "phoneE164",
  "tag",
  "description",
  "seoTitle",
  "seoDescription",
  "orderOnlineUrl",
]);

function getDeep(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setDeep(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const TOOLS: ToolDef[] = [
  {
    name: "get_current",
    description:
      "Read the current value of a content field. Use this to check existing values before proposing changes. Files: 'site' (site config + home copy), 'locations' (all 5 locations as array), 'menu' (menu categories + items), 'posts' (news posts).",
    kind: "read",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", enum: ["site", "locations", "menu", "posts"], description: "Which content file." },
        path: {
          type: "string",
          description:
            "Optional dotted path inside the file. Empty string returns the whole file. Examples: 'home.hero.headline', 'locations[0].phone', 'categories[2].items[1].price'.",
        },
      },
      required: ["file"],
    },
    handler: async ({ file, path }) => {
      const { content } = await ghLoad(file);
      let data: any = content;
      if (path && path.length) {
        // Allow simple [n] index syntax
        const tokens = String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
        for (const t of tokens) data = data == null ? undefined : data[t];
      }
      return {
        summary: `Read ${file}${path ? "." + path : ""}`,
        data,
      };
    },
  },
  {
    name: "set_menu_item_description",
    description:
      "Update the description text of a single menu item. Menu items have these fields: name, description, image. There is no price field — prices on the site are hardcoded in source (the '$1.39 fish taco' is a brand tagline, not editable data). To change a description, provide the category name (case-insensitive substring like 'breakfast plates') and the item name (case-insensitive substring).",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category name, case-insensitive substring match." },
        item: { type: "string", description: "Item name within the category, case-insensitive substring match." },
        description: { type: "string", description: "New description text." },
      },
      required: ["category", "item", "description"],
    },
    handler: async ({ category, item, description }) => {
      const { content } = await ghLoad("menu");
      const cats: any[] = content.categories || [];
      const cat = cats.find((c) => c.name?.toLowerCase().includes(String(category).toLowerCase()));
      if (!cat) throw new Error(`Category "${category}" not found`);
      const it = (cat.items || []).find((i: any) => i.name?.toLowerCase().includes(String(item).toLowerCase()));
      if (!it) throw new Error(`Item "${item}" not found in category "${cat.name}"`);
      const before = it.description;
      it.description = description;
      return {
        summary: `Update ${cat.name} → ${it.name} description`,
        file: "menu",
        newContent: content,
        preview: { path: `${cat.name} → ${it.name} → description`, before, after: description },
      };
    },
  },
  {
    name: "set_location_field",
    description:
      "Update a single field on a location. Allowed fields: phone, phoneE164, tag, description, seoTitle, seoDescription, orderOnlineUrl. Use this for simple location edits (NOT hours — use set_location_hours for that, NOT addresses — those are immutable).",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          enum: ["cardiff-by-the-sea", "carlsbad", "carmel-valley", "del-mar", "la-jolla"],
        },
        field: {
          type: "string",
          enum: ["phone", "phoneE164", "tag", "description", "seoTitle", "seoDescription", "orderOnlineUrl"],
        },
        value: { type: "string", description: "New value for the field." },
      },
      required: ["slug", "field", "value"],
    },
    handler: async ({ slug, field, value }) => {
      if (!LOCATION_FIELD_ALLOWLIST.has(field)) throw new Error(`Field "${field}" not editable.`);
      const { content } = await ghLoad("locations");
      const loc = (content.locations || []).find((l: any) => l.slug === slug);
      if (!loc) throw new Error(`Location "${slug}" not found.`);
      const before = loc[field];
      loc[field] = value;
      return {
        summary: `Set ${slug}.${field} from "${before ?? ""}" to "${value}"`,
        file: "locations",
        newContent: content,
        preview: { path: `${slug} → ${field}`, before, after: value },
      };
    },
  },
  {
    name: "set_location_hours",
    description:
      "Set the opening hours for a single day at a location, or set all 7 days at once. For one day, pass `day` (mon|tue|wed|thu|fri|sat|sun) and `hours` (e.g. '6:00 AM – 12:00 AM' or 'Open 24 hours' or 'Closed'). To update the human-readable summary line, set `summary`.",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          enum: ["cardiff-by-the-sea", "carlsbad", "carmel-valley", "del-mar", "la-jolla"],
        },
        day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "all"] },
        hours: { type: "string", description: "Hours string e.g. '6:00 AM – 12:00 AM' or 'Open 24 hours'." },
        summary: { type: "string", description: "Optional human-readable summary line shown on cards." },
      },
      required: ["slug"],
    },
    handler: async ({ slug, day, hours, summary }) => {
      const { content } = await ghLoad("locations");
      const loc = (content.locations || []).find((l: any) => l.slug === slug);
      if (!loc) throw new Error(`Location "${slug}" not found.`);
      if (!loc.hours) loc.hours = {};
      const before: any = {};
      const after: any = {};
      const days = day === "all" ? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] : day ? [day] : [];
      if (days.length && !hours) throw new Error("hours value required when day is specified");
      for (const d of days) {
        before[d] = loc.hours[d];
        loc.hours[d] = hours;
        after[d] = hours;
      }
      if (summary) {
        before.summary = loc.hours.summary;
        loc.hours.summary = summary;
        after.summary = summary;
      }
      return {
        summary: `Update ${slug} hours${days.length ? " for " + days.join(", ") : ""}${summary ? " (+ summary)" : ""}`,
        file: "locations",
        newContent: content,
        preview: { path: `${slug} → hours`, before, after },
      };
    },
  },
  {
    name: "add_ticker_item",
    description: "Add a new line of text to the home page top ticker (the marquee scroll).",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to add. Will be uppercased visually by CSS." },
        position: { type: "string", enum: ["start", "end"], description: "Where to insert. Default: end." },
      },
      required: ["text"],
    },
    handler: async ({ text, position }) => {
      const { content } = await ghLoad("site");
      const ticker = content.ticker || (content.ticker = []);
      const before = [...ticker];
      if (position === "start") ticker.unshift(text);
      else ticker.push(text);
      return {
        summary: `Add ticker item "${text}" at ${position || "end"}`,
        file: "site",
        newContent: content,
        preview: { path: "ticker", before, after: ticker },
      };
    },
  },
  {
    name: "remove_ticker_item",
    description:
      "Remove a line from the home page ticker. Provide the exact text or a substring that uniquely matches one item.",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "Substring (case-insensitive) that uniquely identifies the item to remove." },
      },
      required: ["match"],
    },
    handler: async ({ match }) => {
      const { content } = await ghLoad("site");
      const ticker: string[] = content.ticker || [];
      const lower = String(match).toLowerCase();
      const matches = ticker.filter((t) => t.toLowerCase().includes(lower));
      if (matches.length === 0) throw new Error(`No ticker item matches "${match}"`);
      if (matches.length > 1) throw new Error(`Multiple ticker items match "${match}": ${matches.join(", ")}. Be more specific.`);
      const before = [...ticker];
      content.ticker = ticker.filter((t) => !t.toLowerCase().includes(lower));
      return {
        summary: `Remove ticker item "${matches[0]}"`,
        file: "site",
        newContent: content,
        preview: { path: "ticker", before, after: content.ticker },
      };
    },
  },
  {
    name: "set_site_field",
    description:
      "Update an allowlisted text field in site.json (mostly hero copy + page eyebrows). Use get_current first to confirm the current value. Allowed paths: " +
      Array.from(SITE_FIELD_ALLOWLIST).join(", "),
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Dotted path. Must be one of the allowlisted paths." },
        value: { type: "string", description: "New string value." },
      },
      required: ["path", "value"],
    },
    handler: async ({ path, value }) => {
      if (!SITE_FIELD_ALLOWLIST.has(path)) throw new Error(`Path "${path}" is not editable.`);
      const { content } = await ghLoad("site");
      const before = getDeep(content, path);
      setDeep(content, path, value);
      return {
        summary: `Set ${path} from "${String(before ?? "").slice(0, 60)}" to "${String(value).slice(0, 60)}"`,
        file: "site",
        newContent: content,
        preview: { path, before, after: value },
      };
    },
  },
  {
    name: "add_news_post",
    description:
      "Add a new news post to /news/. Provide title, slug (kebab-case), and body (plain text or markdown).",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: { type: "string", description: "URL slug, kebab-case. e.g. 'la-jolla-now-open'." },
        body: { type: "string", description: "Post body. Markdown-ish OK." },
        date: { type: "string", description: "Optional ISO date (YYYY-MM-DD). Defaults to today." },
      },
      required: ["title", "slug", "body"],
    },
    handler: async ({ title, slug, body, date }) => {
      const { content } = await ghLoad("posts");
      const posts: any[] = content.posts || (content.posts = []);
      if (posts.find((p) => p.slug === slug)) throw new Error(`Post with slug "${slug}" already exists.`);
      const newPost = {
        slug,
        title,
        date: date || new Date().toISOString().slice(0, 10),
        body,
      };
      posts.unshift(newPost);
      return {
        summary: `Add news post "${title}" (slug: ${slug})`,
        file: "posts",
        newContent: content,
        preview: { path: `posts[0]`, before: null, after: newPost },
      };
    },
  },
  {
    name: "edit_news_post",
    description: "Edit a single field on an existing news post. Allowed fields: title, body, date.",
    kind: "write",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        field: { type: "string", enum: ["title", "body", "date"] },
        value: { type: "string" },
      },
      required: ["slug", "field", "value"],
    },
    handler: async ({ slug, field, value }) => {
      const { content } = await ghLoad("posts");
      const post = (content.posts || []).find((p: any) => p.slug === slug);
      if (!post) throw new Error(`Post "${slug}" not found.`);
      const before = post[field];
      post[field] = value;
      return {
        summary: `Edit post ${slug}.${field}`,
        file: "posts",
        newContent: content,
        preview: { path: `${slug} → ${field}`, before, after: value },
      };
    },
  },
  {
    name: "delete_news_post",
    description: "Delete a news post by slug.",
    kind: "write",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
    handler: async ({ slug }) => {
      const { content } = await ghLoad("posts");
      const idx = (content.posts || []).findIndex((p: any) => p.slug === slug);
      if (idx < 0) throw new Error(`Post "${slug}" not found.`);
      const before = content.posts[idx];
      content.posts.splice(idx, 1);
      return {
        summary: `Delete news post "${before.title}" (${slug})`,
        file: "posts",
        newContent: content,
        preview: { path: `posts[${slug}]`, before, after: null },
      };
    },
  },
];

const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ---------- Anthropic API call ----------

async function callAnthropic(messages: any[], system: string): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Anthropic API ${r.status}: ${detail}`);
  }
  return r.json();
}

const SYSTEM_PROMPT = `You are an admin assistant for El Pueblo Mexican Food's website (elpueblomex.com).

You help restaurant managers update website content. You can:
- Update menu item descriptions (menu items have name, description, image — no price field; prices are not editable via chat)
- Update location phone, tag, description, SEO title/description, order URL
- Update location hours (per-day or all 7 days)
- Add or remove items from the home page ticker
- Add, edit, or delete news posts
- Update brand name, tagline, contact email, and the gives-back disclaimer

Rules:
- Always check the current value before proposing a change (call get_current).
- Be concise and friendly. Talk like a helpful coworker, not a developer.
- Don't say "JSON", "schema", "field path", "commit", or other technical words.
- Don't comment on whether values look like placeholders, test data, or fake — just make the change.
- After a change applies, do not say anything else. The interface already shows a confirmation.
- If asked for something outside what you can do, briefly say what you can do instead.
- Never volunteer unrelated changes.

Rules:
- ALWAYS call get_current to verify a value before proposing a change. Do not assume.
- Use the smallest possible tool — set_menu_item_price for one price, not set_site_field.
- If the user asks for something outside the available tools, politely explain what you can and can't do.
- Be concise. After a tool succeeds, confirm in one short sentence and stop.
- Don't volunteer unrelated changes. Only do what was asked.
- Use plain language; the user is a restaurant manager, not a developer.`;

// ---------- Main handler ----------

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Chat assistant is not configured. Contact your developer." }, 500);
  }
  if (!process.env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN not configured." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
  const confirmedToolUseId: string | undefined = body.confirmedToolUseId;
  const confirmedToolName: string | undefined = body.confirmedToolName;
  const confirmedInput: any = body.confirmedInput;
  const userPrompt: string = body.userPrompt || "";

  const { email: userEmail, role } = getCookieRole(req);

  // If this is a confirmation submission, the front-end has already validated the user
  // wants to apply the previously-proposed change. Execute, commit, then return.
  // We do NOT make another Anthropic call here — the UI shows a "Saved" tag with the
  // commit link, and any follow-up user message will trigger a fresh Anthropic turn
  // with the tool_result already in the message history.
  if (confirmedToolUseId && confirmedToolName && confirmedInput) {
    if ((ROLE_RANK[role] || 0) < ROLE_RANK.manager) {
      return json({ error: "Your account can read but not save changes." }, 403);
    }
    const tool = TOOL_BY_NAME[confirmedToolName];
    if (!tool || tool.kind !== "write") return json({ error: "Invalid tool to confirm." }, 400);
    try {
      const result = await tool.handler(confirmedInput);
      if (!result.file || result.newContent == null) {
        return json({ error: "Tool produced no commit-able change." }, 500);
      }
      const { sha } = await ghLoad(result.file);
      const byLine = userEmail ? ` (${userEmail})` : "";
      const commitMsg = `Admin chat${byLine}: ${result.summary}\n\nPrompt: ${truncate(userPrompt, 200)}`;
      const commit = await ghSave(result.file, result.newContent, sha, commitMsg);
      // Push the tool_result so conversation history is complete for any next turn.
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: confirmedToolUseId,
            content: `Applied successfully. ${result.summary}. Commit: ${commit.url}`,
          },
        ],
      });
      return json({
        messages,
        applied: { summary: result.summary, commitUrl: commit.url, commitSha: commit.commitSha },
      });
    } catch (e: any) {
      // Surface the real error so the UI can show what went wrong.
      const detail = e?.message || String(e);
      return json({ error: `Apply failed: ${detail}` }, 500);
    }
  }

  // Normal turn: call model, auto-execute reads, pause on writes.
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callAnthropic(messages, SYSTEM_PROMPT);
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return json({ messages });
    }

    // Find tool_use blocks in the response
    const toolUses = response.content.filter((b: any) => b.type === "tool_use");
    const toolResults: any[] = [];
    let pendingWrite: any = null;

    for (const tu of toolUses) {
      const tool = TOOL_BY_NAME[tu.name];
      if (!tool) {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Unknown tool: ${tu.name}`, is_error: true });
        continue;
      }
      if (tool.kind === "read") {
        try {
          const result = await tool.handler(tu.input || {});
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({ summary: result.summary, data: result.data }).slice(0, 4000),
          });
        } catch (e: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${e.message || e}`, is_error: true });
        }
      } else {
        // WRITE — pause for confirm OR refuse if read-only.
        if ((ROLE_RANK[role] || 0) < ROLE_RANK.manager) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "I can read information but I cannot save changes for this account. Please ask an account with edit access.",
            is_error: true,
          });
          continue;
        }
        try {
          const preview = await tool.handler(tu.input || {});
          pendingWrite = {
            toolUseId: tu.id,
            toolName: tu.name,
            input: tu.input,
            summary: preview.summary,
            preview: preview.preview,
            file: preview.file,
          };
        } catch (e: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${e.message || e}`, is_error: true });
        }
        break; // pause on first write
      }
    }

    if (pendingWrite) {
      return json({ messages, pending: pendingWrite });
    }

    if (toolResults.length === 0) {
      return json({ messages });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return json({ messages, error: "Max turns exceeded" }, 500);
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
