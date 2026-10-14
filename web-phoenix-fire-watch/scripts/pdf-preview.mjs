/** Dev-only: screenshots rendered pages of the sample branded PDFs from the Vite dev harness. */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const outDir = "/tmp/brand";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console]", m.text());
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/preview-pdf.html");
await page.waitForFunction(() => document.title === "pdf-ready", undefined, { timeout: 60000 });
const previews = await page.evaluate(() => window.__pdfPreviews);
for (const [name, pages] of Object.entries(previews)) {
  for (let i = 0; i < pages.length; i += 1) {
    writeFileSync(`${outDir}/${name}-p${i + 1}.png`, Buffer.from(pages[i].split(",")[1], "base64"));
  }
}
console.log("saved:", Object.entries(previews).map(([n, p]) => `${n}=${p.length}p`).join(" "));
await browser.close();
