"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Eye, FileText, Image as ImageIcon, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { ATTACHMENT_MAX_BYTES } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils";
import { Button, buttonVariants } from "../ui/button";
import { Card } from "../ui/card";
import { ConfirmDialog } from "../ui/dialog";

type Attachment = { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date; uploadedByName: string | null };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function readError(res: Response) {
  try {
    const body = await res.json();
    return body?.error?.message ?? "Upload failed.";
  } catch {
    return "Upload failed.";
  }
}

/** Uploads in chunks so each request stays well below serverless body limits. */
async function uploadFile(itemId: string, file: File, replaceId: string | null, onProgress: (p: number) => void) {
  const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const init = await fetch(`/api/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, fileName: file.name, contentType: type, size: file.size, replaceId }),
  });
  if (!init.ok) throw new Error(await readError(init));
  const { id, chunkCount, chunkSize } = (await init.json()) as { id: string; chunkCount: number; chunkSize: number };
  for (let i = 0; i < chunkCount; i++) {
    const blob = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
    const res = await fetch(`/api/attachments/${id}/chunks/${i}`, { method: "PUT", body: blob, headers: { "Content-Type": "application/octet-stream" } });
    if (!res.ok) throw new Error(await readError(res));
    onProgress((i + 1) / chunkCount);
  }
  const done = await fetch(`/api/attachments/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replaceId }),
  });
  if (!done.ok) throw new Error(await readError(done));
}

export function AttachmentsPanel({ itemId, attachments, canManage }: { itemId: string; attachments: Attachment[]; canManage: boolean }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [deleting, setDeleting] = React.useState<Attachment | null>(null);
  const [deletingBusy, setDeletingBusy] = React.useState(false);

  const pick = (replace: string | null) => {
    setReplaceId(replace);
    input.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(jpe?g|pdf)$/i.test(file.name) && !["image/jpeg", "application/pdf"].includes(file.type)) {
      toast.error("Unsupported file", { description: "Attachments must be JPG images or PDF documents." });
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error("File too large", { description: "Attachments can be at most 10MB." });
      return;
    }
    setProgress(0);
    try {
      await uploadFile(itemId, file, replaceId, setProgress);
      toast.success(replaceId ? "Attachment replaced" : "Attachment uploaded");
      router.refresh();
    } catch (e) {
      toast.error("Upload failed", { description: (e as Error).message });
    } finally {
      setProgress(null);
      setReplaceId(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    const res = await fetch(`/api/attachments/${deleting.id}`, { method: "DELETE" });
    setDeletingBusy(false);
    if (res.ok) {
      toast.success("Attachment deleted");
      setDeleting(null);
      router.refresh();
    } else toast.error("Delete failed", { description: await readError(res) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">Attachments</h2>
          <p className="text-[13px] text-muted">JPG or PDF, up to 10MB. Files inherit this item&apos;s permissions.</p>
        </div>
        {canManage && (
          <Button onClick={() => pick(null)} disabled={progress !== null}>
            {progress !== null ? <Loader2 className="animate-spin" /> : <Upload />} Upload
          </Button>
        )}
        <input ref={input} type="file" accept="image/jpeg,application/pdf,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {progress !== null && (
        <div className="overflow-hidden rounded-full bg-ink/[0.06]" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}
      {attachments.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-muted">No attachments yet.</Card>
      ) : (
        <Card className="divide-y divide-line">
          {attachments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex size-11 items-center justify-center rounded-xl bg-ink/[0.05] text-ink-2">
                {a.contentType === "application/pdf" ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{a.fileName}</p>
                <p className="text-[12.5px] text-muted">
                  {formatBytes(a.sizeBytes)} · {formatDateTime(a.createdAt)}
                  {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <a href={`/api/attachments/${a.id}?inline=1`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`View ${a.fileName}`}>
                  <Eye />
                </a>
                <a href={`/api/attachments/${a.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Download ${a.fileName}`}>
                  <Download />
                </a>
                {canManage && (
                  <>
                    <Button variant="ghost" size="icon-sm" onClick={() => pick(a.id)} aria-label={`Replace ${a.fileName}`} disabled={progress !== null}>
                      <RefreshCw />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(a)} aria-label={`Delete ${a.fileName}`}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete attachment?"
        description={deleting?.fileName}
        confirmLabel="Delete"
        tone="danger"
        loading={deletingBusy}
        onConfirm={remove}
      />
    </div>
  );
}
