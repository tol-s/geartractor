import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { deleteAttachment, readAttachment } from "@/server/attachments";

/** Protected download: only authenticated members of the owning organization can read files. */
export async function GET(req: Request, ctxArg: RouteContext<"/api/attachments/[id]">) {
  const { id } = await ctxArg.params;
  return withRouteContext("attachments.view", async (ctx) => {
    const { meta, data } = await withTenant(ctx.orgId, (tx) => readAttachment(tx, ctx.orgId, id));
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const safeName = meta.fileName.replace(/[^\w.\- ]/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": meta.contentType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}

export async function DELETE(_req: Request, ctxArg: RouteContext<"/api/attachments/[id]">) {
  const { id } = await ctxArg.params;
  return withRouteContext("attachments.manage", async (ctx) => {
    await withTenant(ctx.orgId, (tx) => deleteAttachment(tx, ctx, id));
    return NextResponse.json({ ok: true });
  });
}
