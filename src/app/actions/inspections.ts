"use server";

import { withTenant } from "@/db";
import { actionContext } from "@/server/auth/context";
import { runAction } from "@/server/errors";
import { recordInspection, type InspectionInput } from "@/server/inspections";

export async function recordInspectionAction(input: InspectionInput) {
  return runAction(async () => {
    const ctx = await actionContext("inspection.perform");
    return withTenant(ctx.orgId, (tx) => recordInspection(tx, ctx, input));
  });
}
