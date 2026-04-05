import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

const DEFAULT_CONFIG = {
  minTotalPrice: 500000,
  maxTotalPrice: 850000,
  metroKeywords: [
    "pedro de valdivia",
    "los leones",
    "tobalaba",
    "el golf",
    "alcántara",
    "alcantara",
    "escuela militar",
    "manquehue",
    "metro"
  ],
  newBuildingKeywords: [
    "nuevo",
    "casi nuevo",
    "edificio nuevo",
    "entrega inmediata",
    "proyecto",
    "inmobiliaria"
  ],
  furnishedKeywords: [
    "amoblado",
    "amoblada",
    "full amoblado",
    "full equipada",
    "full equipado",
    "equipado",
    "equipada",
    "amoblado completo"
  ]
};

function normalizeText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function lower(s = "") {
  return normalizeText(s).toLowerCase();
}

function extractNumber(text = "") {
  const digits = String(text).replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function buildTargets() {
  return [
    {
      comuna: "providencia",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/providencia-metropolitana"
    },
    {
      comuna: "las-condes",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/las-condes-metropolitana"
    },
    {
      comuna: "providencia-1d",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/1-dormitorio/providencia-metropolitana"
    },
    {
      comuna: "las-condes-1d",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/1-dormitorio/las-condes-metropolitana"
    },
    {
      comuna: "providencia-2d",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/2-dormitorios/providencia-metropolitana"
    },
    {
      comuna: "las-condes-2d",
      url: "https://www.portalinmobiliario.com/arriendo/departamento/2-dormitorios/las-condes-metropolitana"
    }
  ];
}

function detectBeds(text) {
  const t = lower(text);

  if (
    t.includes("2 dormitorios") ||
    t.includes("2 dormitorio") ||
    t.includes("2 dorm") ||
    t.includes("2d")
  ) return 2;

  if (
    t.includes("1 dormitorio") ||
    t.includes("1 dorm") ||
    t.includes("1d")
  ) return 1;

  return null;
}

function detectBaths(text) {
  const t = lower(text);

  if (t.includes("2 baños") || t.includes("2 baño") || t.includes("2b")) return 2;
  if (t.includes("1 baño") || t.includes("1b")) return 1;

  return null;
}

function isStudio(text) {
  const t = lower(text);
  return (
    t.includes("estudio") ||
    t.includes("monoambiente") ||
    t.includes("un ambiente") ||
    t.includes("home studio") ||
    t.includes("studio")
  );
}

function inferPrice(text) {
  const t = normalizeText(text);

  const clpMatches = [...t.matchAll(/\$\s*([\d\.\,]+)/g)];
  if (clpMatches.length > 0) return extractNumber(clpMatches[0][1]);

  if (/\buf\b/i.test(t)) return null;

  return null;
}

function inferCommonExpenses(text) {
  const t = normalizeText(text);

  const gcMatch =
    t.match(/gastos?\s+comunes?.{0,25}\$?\s*([\d\.\,]+)/i) ||
    t.match(/\bgc\b.{0,20}\$?\s*([\d\.\,]+)/i);

  return gcMatch ? extractNumber(gcMatch[1]) : 0;
}

function enrichAndFilter(items, config) {
  const metroKeywords = config.metroKeywords.map(lower);
  const newBuildingKeywords = config.newBuildingKeywords.map(lower);
  const furnishedKeywords = config.furnishedKeywords.map(lower);

  return items
    .map((item) => {
      const text = lower(item.rawText);

      const beds = detectBeds(item.rawText);
      const baths = detectBaths(item.rawText);
      const studio = isStudio(item.rawText);

      const price = inferPrice(item.rawText);
      const commonExpenses = inferCommonExpenses(item.rawText);
      const totalPrice = price ? price + (commonExpenses || 0) : null;

      const nearMetro = metroKeywords.some((k) => text.includes(k));
      const isNewBuilding = newBuildingKeywords.some((k) => text.includes(k));
      const isFurnished = furnishedKeywords.some((k) => text.includes(k));

      let layoutAllowed = false;
      if (beds === 1 && baths === 1) layoutAllowed = true;
      if (beds === 2 && baths === 1) layoutAllowed = true;
      if (beds === 2 && baths === 2) layoutAllowed = true;

      let score = 0;
      if (isNewBuilding) score += 35;
      if (isFurnished) score += 35;
      if (nearMetro) score += 25;
      if (beds === 2) score += 10;
      if (baths === 2) score += 10;
      if (totalPrice && totalPrice <= 700000) score += 15;
      if (totalPrice && totalPrice <= config.maxTotalPrice) score += 10;

      return {
        ...item,
        beds,
        baths,
        price,
        commonExpenses,
        totalPrice,
        nearMetro,
        isNewBuilding,
        isFurnished,
        isStudio: studio,
        layoutAllowed,
        score
      };
    })
    .filter((x) => !x.isStudio)
    .filter((x) => x.layoutAllowed)
    .filter((x) => x.nearMetro)
    .filter((x) => x.isNewBuilding)
    .filter((x) => x.isFurnished)
    .filter(
      (x) =>
        x.totalPrice &&
        x.totalPrice >= config.minTotalPrice &&
        x.totalPrice <= config.maxTotalPrice
    )
    .sort((a, b) => b.score - a.score);
}

async function autoScroll(page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1200);
  }
}

async function scrapePortalPage(page, target) {
  await page.goto(target.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(3500);
  await autoScroll(page, 5);

  const items = await page.evaluate((sourceUrl) => {
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
      const anchorText = normalizeText(a.innerText || "");
      const cardText = normalizeText(card?.innerText || "");
      const combined = normalizeText(`${anchorText} ${cardText}`);

      if (combined.length < 25) continue;

      const looksLikeListing =
        combined.includes("dormitorio") ||
        combined.includes("baño") ||
        combined.includes("m²") ||
        combined.includes("$");

      if (!looksLikeListing) continue;
      if (seen.has(href)) continue;

      seen.add(href);

      rows.push({
        source: "portalinmobiliario",
        sourceUrl,
        url: href,
        rawText: combined
      });
    }

    return rows;
  }, target.url);

  return items;
}

app.get("/", (req, res) => {
  res.send("Scraper Playwright Portal funcionando 🚀");
});

app.post("/search", async (req, res) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...(req.body || {})
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "es-CL",
      viewport: { width: 1440, height: 2200 }
    });

    const page = await context.newPage();
    const targets = buildTargets();

    let allItems = [];

    for (const target of targets) {
      try {
        const rows = await scrapePortalPage(page, target);
        allItems.push(...rows);
      } catch (err) {
        console.error(`Error scrapeando ${target.url}:`, err.message);
      }
    }

    const filtered = enrichAndFilter(allItems, config);

    const unique = [];
    const seen = new Set();

    for (const item of filtered) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        unique.push(item);
      }
    }

    res.json({
      ok: true,
      rawCount: allItems.length,
      count: unique.length,
      items: unique
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
