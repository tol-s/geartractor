import { isHexColor } from "@/lib/utils";

/** Injects tenant branding as CSS variables so the whole UI adopts the organization's colours. */
export function BrandStyle({ primary, secondary, accent }: { primary: string; secondary: string; accent: string }) {
  const safe = (c: string, fallback: string) => (isHexColor(c) ? c : fallback);
  const css = `:root{--brand:${safe(primary, "#FF6B1A")};--brand-2:${safe(secondary, "#2563EB")};--brand-3:${safe(accent, "#E11D74")};}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
