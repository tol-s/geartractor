import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { attachmentChunks, attachments, users } from "@/db/schema";
import { ATTACHMENT_CHUNK_BYTES, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES } from "@/lib/domain";
import type { OrgContext } from "./auth/context";
import { AppError, NotFoundError } from "./errors";
import { audit } from "./audit";
import { getItemOrThrow } from "./inventory";

type Actor = Pick<OrgContext, "orgId" | "user">;

/**
 * Attachments (JPG/PDF, max 10MB) are uploaded in chunks so each request stays below
 * serverless body limits, stored in Postgres and served only through an authorised route.
 */
export async function initAttachment(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { fileName: string; contentType: string; size: number; replaceId?: string | null },
) {
  const item = await getItemOrThrow(tx, actor.orgId, itemId);
  const contentType = input.contentType === "image/jpg" ? "image/jpeg" : input.contentType;
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(contentType)) {
    throw new AppError("Unsupported file", "Attachments must be JPG images or PDF documents.", "validation");
  }
  if (!(input.size > 0) || input.size > ATTACHMENT_MAX_BYTES) {
    throw new AppError("File too large", "Attachments can be at most 10MB.", "validation");
  }
  const fileName = input.fileName.replace(/[\\/\r\n"]/g, "_").slice(0, 180) || "attachment";
  if (input.replaceId) await getAttachmentRow(tx, actor.orgId, input.replaceId);
  const chunkCount = Math.ceil(input.size / ATTACHMENT_CHUNK_BYTES);
  const [row] = await tx
    .insert(attachments)
    .values({
      organizationId: actor.orgId,
      inventoryItemId: item.id,
      fileName,
      contentType,
      sizeBytes: input.size,
      chunkCount,
      status: "uploading",
      uploadedBy: actor.user.id,
    })
    .returning();
  return { id: row.id, chunkCount, chunkSize: ATTACHMENT_CHUNK_BYTES };
}

async function getAttachmentRow(tx: Tx, orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("attachment");
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.organizationId, orgId)));
  if (!row) throw new NotFoundError("attachment");
  return row;
}

export async function putAttachmentChunk(tx: Tx, actor: Actor, id: string, idx: number, data: Buffer) {
  const row = await getAttachmentRow(tx, actor.orgId, id);
  if (row.status !== "uploading") throw new AppError("Upload finished", "This upload is already complete.", "state");
  if (!Number.isInteger(idx) || idx < 0 || idx >= row.chunkCount) {
    throw new AppError("Invalid chunk", "Upload chunk out of range.", "validation");
  }
  if (data.length === 0 || data.length > ATTACHMENT_CHUNK_BYTES) {
    throw new AppError("Invalid chunk", "Upload chunk has an invalid size.", "validation");
  }
  await tx
    .insert(attachmentChunks)
    .values({ organizationId: actor.orgId, attachmentId: id, idx, data })
    .onConflictDoUpdate({ target: [attachmentChunks.attachmentId, attachmentChunks.idx], set: { data } });
}

export async function completeAttachment(tx: Tx, actor: Actor, id: string, replaceId?: string | null) {
  const row = await getAttachmentRow(tx, actor.orgId, id);
  if (row.status === "ready") return row;
  const [{ n, bytes }] = await tx
    .select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(octet_length(${attachmentChunks.data})), 0)::int` })
    .from(attachmentChunks)
    .where(eq(attachmentChunks.attachmentId, id));
  if (Number(n) !== row.chunkCount || Number(bytes) !== row.sizeBytes) {
    throw new AppError("Upload incomplete", "Some parts of the file are missing. Please upload it again.", "incomplete");
  }
  const [first] = await tx
    .select({ data: attachmentChunks.data })
    .from(attachmentChunks)
    .where(and(eq(attachmentChunks.attachmentId, id), eq(attachmentChunks.idx, 0)));
  const head = first.data.subarray(0, 5);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPdf = head.toString("latin1") === "%PDF-";
  if ((row.contentType === "image/jpeg" && !isJpeg) || (row.contentType === "application/pdf" && !isPdf)) {
    await tx.delete(attachments).where(eq(attachments.id, id));
    throw new AppError("Unsupported file", "The file content does not match a JPG or PDF.", "validation");
  }
  await tx.update(attachments).set({ status: "ready", updatedAt: new Date() }).where(eq(attachments.id, id));
  let replaced: string | null = null;
  if (replaceId && replaceId !== id) {
    const old = await getAttachmentRow(tx, actor.orgId, replaceId);
    await tx.delete(attachments).where(eq(attachments.id, old.id));
    replaced = old.fileName;
  }
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "attachment",
    entityType: "inventory_item",
    entityId: row.inventoryItemId,
    next: { uploaded: row.fileName, sizeBytes: row.sizeBytes, replaced },
  });
  return row;
}

export async function deleteAttachment(tx: Tx, actor: Actor, id: string) {
  const row = await getAttachmentRow(tx, actor.orgId, id);
  await tx.delete(attachments).where(eq(attachments.id, id));
  await audit(tx, {
    organizationId: actor.orgId,
    actorId: actor.user.id,
    action: "attachment",
    entityType: "inventory_item",
    entityId: row.inventoryItemId,
    previous: { deleted: row.fileName },
  });
}

export async function listAttachments(tx: Tx, orgId: string, itemId: string) {
  return tx
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
      createdAt: attachments.createdAt,
      uploadedByName: users.name,
    })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.organizationId, orgId), eq(attachments.inventoryItemId, itemId), eq(attachments.status, "ready")))
    .orderBy(asc(attachments.createdAt));
}

export async function readAttachment(tx: Tx, orgId: string, id: string) {
  const row = await getAttachmentRow(tx, orgId, id);
  if (row.status !== "ready") throw new NotFoundError("attachment");
  const chunks = await tx
    .select({ data: attachmentChunks.data })
    .from(attachmentChunks)
    .where(eq(attachmentChunks.attachmentId, id))
    .orderBy(asc(attachmentChunks.idx));
  return { meta: row, data: Buffer.concat(chunks.map((c) => c.data)) };
}

/** Removes abandoned uploads older than a day. */
export async function purgeStaleUploads(tx: Tx) {
  await tx.execute(sql`delete from attachments where status = 'uploading' and created_at < now() - interval '1 day'`);
}
