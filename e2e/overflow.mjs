import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto("http://localhost:3000/login");
await page.fill("#email", "dj@geartractor.app"); await page.fill("#password", "GearTractor!2026");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);
await page.goto("http://localhost:3000" + process.argv[2], { waitUntil: "networkidle" });
const r = await page.evaluate((all) => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (b.right > window.innerWidth + 1 && b.width > 0) {
      // skip if any ancestor clips
      let p = el.parentElement, clipped = false;
      while (p) { const s = getComputedStyle(p); if (s.overflowX !== "visible") { const pb = p.getBoundingClientRect(); if (pb.right <= window.innerWidth + 1) { clipped = true; break; } } p = p.parentElement; }
      if (!clipped || all) out.push(`${el.tagName}.${(el.className?.toString?.() ?? "").slice(0, 80)} right=${Math.round(b.right)}`);
    }
  }
  return [document.documentElement.scrollWidth, ...out.slice(0, 12)];
}, Boolean(process.env.ALL));
console.log(r.join("\n"));
await browser.close();
