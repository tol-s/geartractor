import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { putAttachmentChunk } from "@/server/attachments";

export async function PUT(req: Request, ctxArg: RouteContext<"/api/attachments/[id]/chunks/[idx]">) {
  const { id, idx } = await ctxArg.params;
  return withRouteContext("attachments.manage", async (ctx) => {
    const data = Buffer.from(await req.arrayBuffer());
    await withTenant(ctx.orgId, (tx) => putAttachmentChunk(tx, ctx, id, Number(idx), data));
    return NextResponse.json({ ok: true });
  });
}
