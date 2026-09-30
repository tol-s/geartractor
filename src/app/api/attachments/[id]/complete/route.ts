import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { completeAttachment } from "@/server/attachments";

export async function POST(req: Request, ctxArg: RouteContext<"/api/attachments/[id]/complete">) {
  const { id } = await ctxArg.params;
  return withRouteContext("attachments.manage", async (ctx) => {
    const body = (await req.json().catch(() => ({}))) as { replaceId?: string | null };
    await withTenant(ctx.orgId, (tx) => completeAttachment(tx, ctx, id, body.replaceId ?? null));
    return NextResponse.json({ ok: true });
  });
}
