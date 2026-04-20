export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const headers = new Headers();
  headers.set("Location", new URL("/admin-login/", req.url).toString());
  headers.append("Set-Cookie", "ep_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers });
}
