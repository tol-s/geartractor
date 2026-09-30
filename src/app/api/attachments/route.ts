import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { initAttachment } from "@/server/attachments";

export async function POST(req: Request) {
  return withRouteContext("attachments.manage", async (ctx) => {
    const body = (await req.json()) as { itemId: string; fileName: string; contentType: string; size: number; replaceId?: string | null };
    const res = await withTenant(ctx.orgId, (tx) =>
      initAttachment(tx, ctx, String(body.itemId), {
        fileName: String(body.fileName ?? ""),
        contentType: String(body.contentType ?? ""),
        size: Number(body.size),
        replaceId: body.replaceId ?? null,
      }),
    );
    return NextResponse.json(res);
  });
}
