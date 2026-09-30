"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Copy, Download, Printer } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Card } from "../ui/card";

export function QrPanel({ qr, item }: { qr: { svg: string; url: string } | null; item: { id: string; code: string; name: string } }) {
  if (!qr) return <Card className="p-8 text-center text-[14px] text-muted">No QR code for this item.</Card>;
  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <Card className="flex flex-col items-center p-6">
        <div className="w-full max-w-[240px] rounded-2xl border border-line bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
        <p className="mt-3 font-mono text-[15px] font-bold">{item.code}</p>
        <p className="text-[13px] text-muted">{item.name}</p>
      </Card>
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-[16px] font-bold">QR code</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            The code resolves to this record permanently, even if the name, location or status changes. Scanning requires signing in to this organization.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
          <code className="min-w-0 flex-1 truncate text-[12.5px]">{qr.url}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy link"
            onClick={() => {
              navigator.clipboard?.writeText(qr.url).then(() => toast.success("Link copied", { id: "qr-copy" }));
            }}
          >
            <Copy />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/qr/${item.id}?format=png`} download={`${item.code}.png`} className={buttonVariants({ variant: "secondary" })}>
            <Download /> PNG
          </a>
          <a href={`/api/qr/${item.id}?format=svg`} download={`${item.code}.svg`} className={buttonVariants({ variant: "secondary" })}>
            <Download /> SVG
          </a>
          <Link href={`/print/labels?ids=${item.id}`} target="_blank" className={buttonVariants({ variant: "primary" })}>
            <Printer /> Print label
          </Link>
        </div>
      </Card>
    </div>
  );
}
