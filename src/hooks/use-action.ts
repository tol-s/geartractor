"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionError, ActionResult } from "@/server/errors";

/**
 * Runs a server action, shows a single toast for the outcome and refreshes server data.
 * Errors are always human readable (never raw technical output).
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<ActionResult<T>>,
  opts: {
    success?: string | ((data: T) => string | null);
    refresh?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: ActionError) => void;
    toastErrors?: boolean;
  } = {},
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  const run = useCallback(
    (...args: Args) =>
      new Promise<ActionResult<T>>((resolve) => {
        setError(null);
        startTransition(async () => {
          let result: ActionResult<T>;
          try {
            result = await action(...args);
          } catch {
            result = {
              ok: false,
              error: { title: "Connection problem", message: "Please check your connection and try again.", code: "network" },
            };
          }
          if (result.ok) {
            const msg = typeof opts.success === "function" ? opts.success(result.data) : opts.success;
            if (msg) toast.success(msg, { id: msg });
            opts.onSuccess?.(result.data);
            if (opts.refresh !== false) router.refresh();
          } else {
            setError(result.error);
            if (opts.toastErrors !== false) {
              toast.error(result.error.title, { description: result.error.message, id: `${result.error.code}:${result.error.message}` });
            }
            opts.onError?.(result.error);
          }
          resolve(result);
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, router, opts.success, opts.refresh],
  );

  return { run, pending, error, setError };
}
