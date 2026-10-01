// Generates small JPEG/PDF fixtures used by the demo seed as attachments.
import { chromium } from "@playwright/test";
const out = "scripts/seed-assets";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const photos = [
  ["helmet", "#FF6B1A", "Helmet", "Serial plate and shell condition"],
  ["harness", "#2563EB", "Harness", "Webbing and buckle close-up"],
  ["chainsaw", "#16A34A", "Chainsaw", "Bar, chain and brake check"],
  ["rope", "#E11D74", "Rope", "Sheath inspection at 12m"],
  ["camera", "#7C3AED", "Camera body", "Sensor and mount condition"],
];
for (const [file, color, title, sub] of photos) {
  await page.setContent(`<body style="margin:0;font-family:sans-serif;background:linear-gradient(135deg,${color},#0b0b0f);height:600px;display:flex;align-items:center;justify-content:center;color:white">
  <div style="text-align:center"><div style="width:180px;height:180px;margin:0 auto 24px;border-radius:40px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:90px">⚙</div>
  <div style="font-size:44px;font-weight:800">${title}</div><div style="font-size:22px;opacity:.8;margin-top:8px">${sub}</div>
  <div style="font-size:16px;opacity:.6;margin-top:28px">Gear Tractor demo photo</div></div></body>`);
  await page.screenshot({ path: `${out}/${file}.jpg`, type: "jpeg", quality: 70 });
}
const docs = [
  ["user-manual", "Manufacturer Instructions for Use", ["Read all instructions before use.", "Inspect before and after each use.", "Retire after a fall arrest or if in doubt.", "Store dry, away from chemicals and UV.", "Lifespan: up to 10 years from manufacture."]],
  ["certificate-of-conformity", "Certificate of Conformity", ["Product complies with the applicable EN standards.", "Batch tested and released by quality control.", "Notified body: 0082.", "Serial number recorded on the product label."]],
  ["inspection-report", "Thorough Examination Report", ["Examination type: periodic (12 months).", "Visual and tactile inspection completed.", "Result: PASS. Safe for continued use.", "Next examination due within 12 months."]],
];
for (const [file, title, lines] of docs) {
  await page.setContent(`<body style="font-family:sans-serif;padding:48px;color:#0b0b0f"><div style="display:flex;align-items:center;gap:14px;margin-bottom:30px"><div style="width:44px;height:44px;border-radius:12px;background:#FF6B1A"></div><div style="font-size:20px;font-weight:700">Gear Tractor</div></div>
  <h1 style="font-size:30px">${title}</h1><p style="color:#6b6b76">Demo document generated for the Gear Tractor seed data.</p>
  <ol style="font-size:16px;line-height:1.9">${lines.map((l) => `<li>${l}</li>`).join("")}</ol>
  <p style="margin-top:60px;color:#6b6b76;font-size:13px">Signed: Inspector · Gear Tractor Equipment Services</p></body>`);
  await page.pdf({ path: `${out}/${file}.pdf`, format: "A4" });
}
await browser.close();
console.log("assets written");
