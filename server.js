import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

function normalizeText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

app.get("/", (req, res) => {
  res.send("Scraper debug Portal funcionando 🚀");
});

app.post("/search", async (req, res) => {
  const targetUrl =
    "https://www.portalinmobiliario.com/arriendo/departamento/providencia-metropolitana";

  let browser;

  try {
    console.log("POST /search iniciado");

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "es-CL",
      viewport: { width: 1280, height: 1200 }
    });

    const page = await context.newPage();

    console.log("Abriendo:", targetUrl);

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });

    await page.waitForTimeout(1000);

    const items = await page.evaluate(() => {
      function normalizeText(s = "") {
        return String(s).replace(/\s+/g, " ").trim();
      }

      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const rows = [];
      const seen = new Set();

      for (const a of anchors) {
        const href = a.href;
        if (!href) continue;
        if (!href.includes("portalinmobiliario.com")) continue;

        const card = a.closest("li, article, div");
        const text = normalizeText(`${a.innerText || ""} ${card?.innerText || ""}`);

        if (text.length < 30) continue;
        if (!text.includes("$")) continue;
        if (seen.has(href)) continue;

        seen.add(href);

        rows.push({
          url: href,
          rawText: text.slice(0, 500)
        });

        if (rows.length >= 10) break;
      }

      return rows;
    });

    console.log("Items encontrados:", items.length);

    res.json({
      ok: true,
      count: items.length,
      items
    });
  } catch (err) {
    console.error("Error en /search:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
