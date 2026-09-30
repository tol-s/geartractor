import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { ensureQrCode, qrPng, qrSvg } from "@/server/qr";
import { getItemOrThrow } from "@/server/inventory";

export async function GET(req: Request, ctxArg: RouteContext<"/api/qr/[id]">) {
  const { id } = await ctxArg.params;
  return withRouteContext("inventory.view", async (ctx) => {
    const { item, qr } = await withTenant(ctx.orgId, async (tx) => {
      const item = await getItemOrThrow(tx, ctx.orgId, id);
      return { item, qr: await ensureQrCode(tx, ctx.orgId, id) };
    });
    const format = new URL(req.url).searchParams.get("format") === "svg" ? "svg" : "png";
    if (format === "svg") {
      return new Response(await qrSvg(qr.token), {
        headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `attachment; filename="${item.code}.svg"`, "Cache-Control": "private, max-age=3600" },
      });
    }
    const png = await qrPng(qr.token, 768);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${item.code}.png"`, "Cache-Control": "private, max-age=3600" },
    });
  });
}
