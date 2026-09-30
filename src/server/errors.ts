/**
 * User-facing errors. Messages are written for people, never raw technical output.
 */
export class AppError extends Error {
  constructor(
    public title: string,
    message: string,
    public code: string = "app_error",
    public meta: { itemId?: string; itemCode?: string; href?: string; details?: string[] } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("Not allowed", message, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(what = "record") {
    super("Not found", `The ${what} could not be found or you do not have access to it.`, "not_found");
  }
}

export type ActionError = {
  title: string;
  message: string;
  code: string;
  itemId?: string;
  itemCode?: string;
  href?: string;
  details?: string[];
  fieldErrors?: Record<string, string>;
};

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError };

type PgError = { code?: string; constraint?: string; cause?: unknown };

function pgErrorOf(err: unknown): PgError | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    const c = cur as PgError;
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

/** Maps any thrown value to a safe, human-readable ActionError. */
export function toActionError(err: unknown): ActionError {
  if (err instanceof AppError) {
    return { title: err.title, message: err.message, code: err.code, ...err.meta };
  }
  const zodIssues = (err as { issues?: { path: (string | number)[]; message: string }[] })?.issues;
  if (Array.isArray(zodIssues)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of zodIssues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return {
      title: "Please check the form",
      message: zodIssues[0]?.message ?? "Some fields are invalid.",
      code: "validation",
      fieldErrors,
    };
  }
  const pg = pgErrorOf(err);
  if (pg) {
    switch (pg.constraint) {
      case "checkout_items_one_issued":
        return {
          title: "Unable to checkout equipment",
          message: "One or more items were just checked out by someone else. Refresh and try again.",
          code: "conflict",
        };
      case "reservation_items_no_overlap":
        return {
          title: "Unable to reserve equipment",
          message: "One or more items are already reserved for an overlapping time.",
          code: "conflict",
        };
      case "stock_no_over_allocation":
      case "stock_non_negative":
        return {
          title: "Insufficient stock",
          message: "There is not enough unallocated stock for this quantity.",
          code: "insufficient_stock",
        };
      case "users_email_unique":
        return { title: "Email already in use", message: "A user with this email already exists.", code: "duplicate" };
      case "organizations_slug_unique":
        return { title: "Slug already in use", message: "Another organization already uses this slug.", code: "duplicate" };
      case "assignments_active_child_unique":
        return {
          title: "Already assigned",
          message: "This item is already assigned to another Configuration or Kit.",
          code: "conflict",
        };
    }
    if (pg.code === "23505") {
      return { title: "Already exists", message: "A record with these details already exists.", code: "duplicate" };
    }
    if (pg.code === "42501") {
      return { title: "Not allowed", message: "You do not have access to this record.", code: "forbidden" };
    }
    if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
      return {
        title: "Please try again",
        message: "Someone else was updating the same equipment. Please retry.",
        code: "conflict",
      };
    }
  }
  console.error("[gear-tractor] unexpected error", err);
  return {
    title: "Something went wrong",
    message: "We could not complete this action. Please try again.",
    code: "unexpected",
  };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // Let Next.js navigation signals (redirect/notFound) propagate.
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR"))) {
      throw err;
    }
    return { ok: false, error: toActionError(err) };
  }
}
