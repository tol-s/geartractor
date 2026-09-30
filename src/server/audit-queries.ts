import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { auditLogs, statusHistory, users } from "@/db/schema";

export type AuditFilters = { entityId?: string; action?: string; q?: string; page?: number; pageSize?: number };

export async function listAuditLogs(tx: Tx, orgId: string, f: AuditFilters) {
  const pageSize = Math.min(f.pageSize ?? 30, 200);
  const page = Math.max(f.page ?? 1, 1);
  const where: SQL[] = [eq(auditLogs.organizationId, orgId)];
  if (f.entityId) where.push(eq(auditLogs.entityId, f.entityId));
  if (f.action && f.action !== "all") where.push(eq(auditLogs.action, f.action));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(${auditLogs.entityLabel} ilike ${like} or ${auditLogs.reason} ilike ${like} or ${auditLogs.entityType} ilike ${like})`);
  }
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(and(...where));
  const rows = await tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      entityLabel: auditLogs.entityLabel,
      previous: auditLogs.previous,
      next: auditLogs.next,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>["rows"][number];

export async function itemStatusHistory(tx: Tx, orgId: string, itemId: string) {
  return tx
    .select({
      id: statusHistory.id,
      previousStatus: statusHistory.previousStatus,
      newStatus: statusHistory.newStatus,
      reason: statusHistory.reason,
      source: statusHistory.source,
      createdAt: statusHistory.createdAt,
      userName: users.name,
    })
    .from(statusHistory)
    .leftJoin(users, eq(users.id, statusHistory.changedBy))
    .where(and(eq(statusHistory.organizationId, orgId), eq(statusHistory.inventoryItemId, itemId)))
    .orderBy(desc(statusHistory.createdAt))
    .limit(100);
}

export async function recentActivity(tx: Tx, orgId: string, opts: { userId?: string; limit?: number } = {}) {
  return tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      entityLabel: auditLogs.entityLabel,
      next: auditLogs.next,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(
      and(
        eq(auditLogs.organizationId, orgId),
        sql`${auditLogs.action} <> 'login'`,
        sql`${auditLogs.entityType} in ('checkout','reservation','component','configuration','kit','consumable')`,
        opts.userId ? eq(auditLogs.actorId, opts.userId) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(opts.limit ?? 40);
}
