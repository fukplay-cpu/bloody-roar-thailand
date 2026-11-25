// br2-upload-gateway — ส่งไฟล์เกมเฉพาะคนที่มีรหัส (Secret: DOWNLOAD_KEY)
// วิธีใช้: คัดลอกไฟล์นี้ทั้งหมดไปวางแทนโค้ดเดิมใน Cloudflare → Workers & Pages → br2-upload-gateway → Edit code → Deploy
// ถ้ายังไม่ได้ตั้ง DOWNLOAD_KEY จะไม่มีใครโหลดได้เลย (ปิดไว้ก่อนเพื่อความปลอดภัย)
const GAME_KEY = "bloody-roar-2.zip";
const ALLOWED_ORIGIN = "https://fukplay-cpu.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-BR2-Key",
    "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function response(data, status) {
  return new Response(data, { status, headers: corsHeaders() });
}

// เทียบรหัสแบบใช้เวลาเท่ากันทุกครั้ง (กันการเดารหัสจากเวลาตอบ)
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b)))
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function downloadAllowed(request, env) {
  const key = request.headers.get("X-BR2-Key") || "";
  if (!env.DOWNLOAD_KEY || !key) return false;
  return sameSecret(key, env.DOWNLOAD_KEY);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders();
    if (request.method === "OPTIONS") return new Response(null, { headers });

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    try {
      if (action === "get" && request.method === "GET") {
        if (!(await downloadAllowed(request, env))) return response("Unauthorized", 401);
        if (!request.headers.has("Range")) return response("Range header required", 416);

        const meta = await env.GAME_BUCKET.head(GAME_KEY);
        if (!meta) return response("Game file not found", 404);

        const match = request.headers.get("Range").match(/^bytes=(\d+)-(\d*)$/);
        if (!match) return response("Bad range", 416);
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), meta.size - 1) : meta.size - 1;
        if (start >= meta.size || end < start) return response("Bad range", 416);

        const length = end - start + 1;
        const object = await env.GAME_BUCKET.get(GAME_KEY, { range: { offset: start, length } });
        if (!object) return response("Game file not found", 404);

        const h = new Headers(headers);
        h.set("Content-Type", "application/zip");
        h.set("Accept-Ranges", "bytes");
        h.set("Content-Length", String(length));
        h.set("Content-Range", `bytes ${start}-${end}/${meta.size}`);
        h.set("Cache-Control", "private, no-store");
        return new Response(object.body, { status: 206, headers: h });
      }

      // ส่วนอัปโหลดเดิม (ต้องใช้ UPLOAD_TOKEN) — คงไว้เหมือนเดิม
      const token = request.headers.get("Authorization") || "";
      if (!env.UPLOAD_TOKEN || !(await sameSecret(token, `Bearer ${env.UPLOAD_TOKEN}`))) {
        return response("Unauthorized", 401);
      }

      if (action === "create" && request.method === "POST") {
        const upload = await env.GAME_BUCKET.createMultipartUpload(GAME_KEY);
        return response(JSON.stringify({ key: upload.key, uploadId: upload.uploadId }), 200);
      }

      if (action === "part" && request.method === "PUT") {
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !request.body) {
          return response("Invalid upload data", 400);
        }
        const upload = env.GAME_BUCKET.resumeMultipartUpload(GAME_KEY, uploadId);
        const part = await upload.uploadPart(partNumber, await request.arrayBuffer());
        return response(JSON.stringify(part), 200);
      }

      if (action === "complete" && request.method === "POST") {
        const uploadId = url.searchParams.get("uploadId");
        if (!uploadId) return response("Missing uploadId", 400);
        const body = await request.json();
        if (!Array.isArray(body.parts) || body.parts.length === 0) return response("Missing parts", 400);
        const upload = env.GAME_BUCKET.resumeMultipartUpload(GAME_KEY, uploadId);
        const object = await upload.complete(body.parts);
        return response(JSON.stringify({ success: true, key: object.key, size: object.size }), 200);
      }

      if (action === "abort" && request.method === "DELETE") {
        const uploadId = url.searchParams.get("uploadId");
        if (!uploadId) return response("Missing uploadId", 400);
        const upload = env.GAME_BUCKET.resumeMultipartUpload(GAME_KEY, uploadId);
        await upload.abort();
        return response("Upload cancelled", 200);
      }

      return response("Unknown action", 400);
    } catch (error) {
      return response("Server error", 500);
    }
  }
};
