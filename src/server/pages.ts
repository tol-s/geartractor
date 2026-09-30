import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./errors";

/** Converts a NotFoundError (including cross-tenant access) into the 404 page. */
export async function notFoundOnError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
