import "server-only";
import { NextResponse } from "next/server";
import { actionContext, type OrgContext } from "./auth/context";
import type { Permission } from "./auth/permissions";
import { toActionError } from "./errors";

const STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  validation: 400,
  rate_limited: 429,
  conflict: 409,
  duplicate: 409,
};

/** Route handler wrapper: authenticated tenant context + human-readable JSON errors. */
export async function withRouteContext(permission: Permission | undefined, fn: (ctx: OrgContext) => Promise<Response>) {
  try {
    const ctx = await actionContext(permission);
    return await fn(ctx);
  } catch (err) {
    const error = toActionError(err);
    return NextResponse.json({ error }, { status: STATUS[error.code] ?? (error.code === "unexpected" ? 500 : 400) });
  }
}
