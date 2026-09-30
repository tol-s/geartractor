// Visual QA helper: logs in and captures screenshots at the given widths.
// Usage: node e2e/shots.mjs <outDir> <path1,path2> [widths] [email]
import { chromium } from "@playwright/test";

const [outDir, pathsArg, widthsArg = "390,1440", email = "dj@geartractor.app"] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const password = process.env.SEED_DEMO_PASSWORD ?? "GearTractor!2026";
const executablePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath });
for (const w of widthsArg.split(",").map(Number)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (email !== "none") {
    await page.goto(`${base}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  }
  for (const p of pathsArg.split(",")) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const name = `${outDir}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}_${w}.png`;
    await page.screenshot({ path: name, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${name} overflowX=${overflow}`);
  }
  if (errors.length) console.log(`console errors @${w}:`, errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
