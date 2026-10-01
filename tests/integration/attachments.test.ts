import { afterAll, describe, expect, it } from "vitest";
import { completeAttachment, initAttachment, listAttachments, putAttachmentChunk, readAttachment } from "@/server/attachments";
import { NotFoundError } from "@/server/errors";
import { createTenant, inTenant, makeItem, pool } from "../helpers";

afterAll(() => pool.end());

const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(5000, 65)]);

describe("attachments", () => {
  it("uploads in chunks, validates content and keeps files private to the tenant", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    const init = await inTenant(t, (tx) => initAttachment(tx, t.admin, item.id, { fileName: "manual.pdf", contentType: "application/pdf", size: pdf.length }));
    expect(init.chunkCount).toBe(1);
    await expect(inTenant(t, (tx) => completeAttachment(tx, t.admin, init.id))).rejects.toThrow(/missing/);
    await inTenant(t, (tx) => putAttachmentChunk(tx, t.admin, init.id, 0, pdf));
    await inTenant(t, (tx) => completeAttachment(tx, t.admin, init.id));
    const file = await inTenant(t, (tx) => readAttachment(tx, t.org.id, init.id));
    expect(file.data.equals(pdf)).toBe(true);
    expect(await inTenant(t, (tx) => listAttachments(tx, t.org.id, item.id))).toHaveLength(1);
    await expect(inTenant(other, (tx) => readAttachment(tx, other.org.id, init.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects unsupported types, oversized files and spoofed content", async () => {
    const t = await createTenant();
    const item = await makeItem(t, { kind: "component" });
    await expect(inTenant(t, (tx) => initAttachment(tx, t.admin, item.id, { fileName: "a.png", contentType: "image/png", size: 10 }))).rejects.toThrow(/JPG/);
    await expect(
      inTenant(t, (tx) => initAttachment(tx, t.admin, item.id, { fileName: "big.pdf", contentType: "application/pdf", size: 10 * 1024 * 1024 + 1 })),
    ).rejects.toThrow(/10MB/);
    const fake = Buffer.from("not really a jpeg");
    const init = await inTenant(t, (tx) => initAttachment(tx, t.admin, item.id, { fileName: "x.jpg", contentType: "image/jpeg", size: fake.length }));
    await inTenant(t, (tx) => putAttachmentChunk(tx, t.admin, init.id, 0, fake));
    await expect(inTenant(t, (tx) => completeAttachment(tx, t.admin, init.id))).rejects.toThrow(/does not match/);
  });
});
