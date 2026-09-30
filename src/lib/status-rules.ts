import { addMonthsIso } from "./utils";
import {
  KIND_LABEL,
  STATUS_SEVERITY,
  type InventoryKind,
  type ItemStatus,
  type LifespanMode,
  type ExpiryBasis,
} from "./domain";

/**
 * Pure status rules (no database access) so they can be unit tested and reused.
 *
 * Rules implemented from the specification:
 *  - Lifespan: Finite / Explicit Expiry / Unlimited. Expiry basis: Manufacture or First Use date.
 *    The earlier applicable expiry wins. Missing expiry information blocks checkout.
 *    Unlimited items show "Pending Inspection" as expiry and remain subject to inspection.
 *  - Statuses: Available, Needs Inspection, Missing, Rejected. Priority Rejected > Missing > Needs Inspection.
 *  - Propagation: Component -> Configuration -> Kit (all nested paths). A parent can never be
 *    Available while a restricted child remains; all contributing reasons are listed.
 */

export type ReasonSeverity = "rejected" | "missing" | "needs_inspection" | "blocker";

export type Reason = {
  code:
    | "flagged"
    | "missing"
    | "rejected"
    | "expired"
    | "inspection_overdue"
    | "inspection_missing"
    | "expiry_info_missing"
    | "consumable_shortage"
    | "child";
  label: string;
  severity: ReasonSeverity;
  sourceItemId?: string;
  sourceCode?: string;
  path?: string[];
};

export type StatusInputItem = {
  id: string;
  code: string;
  name: string;
  kind: InventoryKind;
  status: ItemStatus;
  lifespanMode: LifespanMode;
  lifespanMonths: number | null;
  expiryBasis: ExpiryBasis | null;
  manufactureDate: string | null;
  firstUseDate: string | null;
  explicitExpiry: string | null;
  annualInspectionRequired: boolean;
  nextInspectionDate: string | null;
};

export type StatusInputAllocation = {
  parentId: string;
  consumableId: string;
  required: number;
  allocated: number;
};

export type StatusResult = {
  computedExpiry: string | null;
  expiryInfoMissing: boolean;
  effectiveStatus: ItemStatus;
  reasons: Reason[];
  checkoutBlocked: boolean;
};

export type ExpiryResult = { expiry: string | null; missingInfo: boolean; pendingInspection: boolean };

export function computeExpiry(item: Pick<
  StatusInputItem,
  "lifespanMode" | "lifespanMonths" | "expiryBasis" | "manufactureDate" | "firstUseDate" | "explicitExpiry"
>): ExpiryResult {
  if (item.lifespanMode === "unlimited") {
    return { expiry: null, missingInfo: false, pendingInspection: true };
  }
  const candidates: string[] = [];
  let missingInfo = false;
  if (item.lifespanMode === "finite") {
    const basisDate =
      item.expiryBasis === "first_use_date"
        ? item.firstUseDate
        : item.expiryBasis === "manufacture_date"
          ? item.manufactureDate
          : null;
    if (!item.lifespanMonths || item.lifespanMonths <= 0 || !item.expiryBasis || !basisDate) {
      missingInfo = true;
    } else {
      candidates.push(addMonthsIso(basisDate, item.lifespanMonths));
    }
    if (item.explicitExpiry) candidates.push(item.explicitExpiry);
  } else if (item.lifespanMode === "explicit") {
    if (!item.explicitExpiry) missingInfo = true;
    else candidates.push(item.explicitExpiry);
  }
  // Earlier applicable expiry wins.
  const expiry = candidates.length ? candidates.sort()[0] : null;
  // An explicit expiry still gives a hard date even if lifespan info is incomplete, but the
  // incomplete lifespan is still reported as missing information.
  return { expiry, missingInfo, pendingInspection: false };
}

function severityRank(s: ReasonSeverity): number {
  return s === "blocker" ? 0 : STATUS_SEVERITY[s];
}

export function ownReasons(item: StatusInputItem, today: string, expiry: ExpiryResult): Reason[] {
  const reasons: Reason[] = [];
  const src = { sourceItemId: item.id, sourceCode: item.code };
  if (item.status === "rejected") reasons.push({ code: "rejected", label: "Marked Rejected", severity: "rejected", ...src });
  if (item.status === "missing") reasons.push({ code: "missing", label: "Reported Missing", severity: "missing", ...src });
  if (item.status === "needs_inspection")
    reasons.push({ code: "flagged", label: "Flagged for inspection", severity: "needs_inspection", ...src });
  if (expiry.missingInfo)
    reasons.push({ code: "expiry_info_missing", label: "Expiry information missing", severity: "blocker", ...src });
  if (expiry.expiry && expiry.expiry <= today)
    reasons.push({ code: "expired", label: `Expired on ${expiry.expiry}`, severity: "needs_inspection", ...src });
  if (item.annualInspectionRequired) {
    if (!item.nextInspectionDate) {
      reasons.push({ code: "inspection_missing", label: "No inspection on record", severity: "needs_inspection", ...src });
    } else if (item.nextInspectionDate < today) {
      reasons.push({
        code: "inspection_overdue",
        label: `Inspection overdue since ${item.nextInspectionDate}`,
        severity: "needs_inspection",
        ...src,
      });
    }
  }
  return reasons;
}

function statusFromReasons(reasons: Reason[]): ItemStatus {
  let best: ItemStatus = "available";
  for (const r of reasons) {
    if (r.severity === "blocker") continue;
    if (STATUS_SEVERITY[r.severity] > STATUS_SEVERITY[best]) best = r.severity;
  }
  return best;
}

/**
 * Computes effective status for every item, propagating child issues to all ancestors.
 * `children` maps parent id -> child ids (tracked assignments).
 */
export function computeStatuses(
  items: StatusInputItem[],
  children: Map<string, string[]>,
  allocations: StatusInputAllocation[],
  today: string,
): Map<string, StatusResult> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const allocByParent = new Map<string, StatusInputAllocation[]>();
  for (const a of allocations) {
    const list = allocByParent.get(a.parentId) ?? [];
    list.push(a);
    allocByParent.set(a.parentId, list);
  }
  const results = new Map<string, StatusResult>();
  const visiting = new Set<string>();

  const visit = (id: string): StatusResult => {
    const cached = results.get(id);
    if (cached) return cached;
    const item = byId.get(id)!;
    visiting.add(id);
    const expiry = computeExpiry(item);
    const reasons = ownReasons(item, today, expiry);

    for (const a of allocByParent.get(id) ?? []) {
      const consumable = byId.get(a.consumableId);
      if (!consumable) continue;
      if (a.allocated < a.required) {
        reasons.push({
          code: "consumable_shortage",
          label: `Consumable shortage: ${consumable.name} (${a.allocated}/${a.required})`,
          severity: "needs_inspection",
          sourceItemId: consumable.id,
          sourceCode: consumable.code,
        });
      }
      // Allocated consumables contribute their own issues (e.g. expired fuel).
      const cr = visit(consumable.id);
      for (const r of cr.reasons) reasons.push(childReason(consumable, r));
    }

    for (const childId of children.get(id) ?? []) {
      if (visiting.has(childId) || !byId.has(childId)) continue; // cycle guard
      const child = byId.get(childId)!;
      const cr = visit(childId);
      for (const r of cr.reasons) reasons.push(childReason(child, r));
    }

    visiting.delete(id);
    const effectiveStatus = statusFromReasons(reasons);
    reasons.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const result: StatusResult = {
      computedExpiry: expiry.expiry,
      expiryInfoMissing: expiry.missingInfo,
      effectiveStatus,
      reasons,
      checkoutBlocked: effectiveStatus !== "available" || reasons.some((r) => r.severity === "blocker"),
    };
    results.set(id, result);
    return result;
  };

  for (const item of items) visit(item.id);
  return results;
}

function childReason(child: StatusInputItem, r: Reason): Reason {
  if (r.code === "child") {
    return { ...r, path: [child.code, ...(r.path ?? [])] };
  }
  const descriptor = `${KIND_LABEL[child.kind]} ${child.code} (${child.name})`;
  return {
    code: "child",
    label: `${descriptor}: ${lowerFirst(r.label)}`,
    severity: r.severity,
    sourceItemId: r.sourceItemId ?? child.id,
    sourceCode: r.sourceCode ?? child.code,
    path: [child.code],
  };
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Detects whether making `childId` a child of `parentId` would create a cycle. */
export function wouldCreateCycle(parentId: string, childId: string, parentOf: Map<string, string>): boolean {
  if (parentId === childId) return true;
  let cur: string | undefined = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === childId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}
