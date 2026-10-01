import { sql } from "drizzle-orm";

/**
 * Fully qualified outer-table columns for correlated subqueries inside raw SQL.
 * Drizzle renders `${table.column}` unqualified when a query has no joins, which would
 * silently bind to a same-named column of the subquery's own table.
 */
export const Q = {
  itemId: sql.raw(`"inventory_items"."id"`),
  checkoutId: sql.raw(`"checkouts"."id"`),
  organizationId: sql.raw(`"organizations"."id"`),
  inspectionId: sql.raw(`"inspections"."id"`),
  reservationId: sql.raw(`"reservations"."id"`),
  userId: sql.raw(`"users"."id"`),
};
