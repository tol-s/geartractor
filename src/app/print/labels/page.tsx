import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { inventoryItems, qrCodes } from "@/db/schema";
import { ensureQrCode, qrSvg } from "@/server/qr";
import { KIND_LABEL } from "@/lib/domain";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "QR labels" };

export default async function PrintLabelsPage(props: PageProps<"/print/labels">) {
  const ctx = await requireOrgContext("inventory.view");
  const sp = await props.searchParams;
  const ids = String(sp.ids ?? "")
    .split(",")
    .filter((i) => /^[0-9a-f-]{36}$/i.test(i))
    .slice(0, 120);
  const labels = await withTenant(ctx.orgId, async (tx) => {
    if (!ids.length) return [];
    const items = await tx
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, ctx.orgId), inArray(inventoryItems.id, ids)));
    for (const i of items) await ensureQrCode(tx, ctx.orgId, i.id);
    const qrs = await tx.select().from(qrCodes).where(inArray(qrCodes.inventoryItemId, items.map((i) => i.id)));
    await tx.update(qrCodes).set({ lastPrintedAt: new Date() }).where(inArray(qrCodes.inventoryItemId, items.map((i) => i.id)));
    return Promise.all(
      items.map(async (i) => ({ ...i, svg: await qrSvg(qrs.find((q) => q.inventoryItemId === i.id)!.token) })),
    );
  });
  return (
    <div className="min-h-dvh bg-white p-6 text-black">
      <div className="no-print mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold">QR labels</h1>
          <p className="text-[13px] text-neutral-500">{labels.length} label(s) · {ctx.org.name}</p>
        </div>
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
        {labels.map((l) => (
          <div key={l.id} className="flex break-inside-avoid items-center gap-3 rounded-xl border border-neutral-300 p-3">
            <div className="size-24 shrink-0 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="min-w-0">
              <p className="font-mono text-[15px] font-bold">{l.code}</p>
              <p className="truncate text-[13px] font-semibold">{l.name}</p>
              <p className="text-[11px] text-neutral-500">
                {KIND_LABEL[l.kind]} · {ctx.org.name}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
