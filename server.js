import express from "express";
import * as cheerio from "cheerio";

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
  ],
  newBuildingKeywords: [
    "nuevo",
    "casi nuevo",
    "edificio semi nuevo",
    "edificio seminuevo",
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
    "equipada"
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

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "es-CL,es;q=0.9,en;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} en ${url}`);
  }

  return await res.text();
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
  if (clpMatches.length > 0) {
    return extractNumber(clpMatches[0][1]);
  }

  if (/\buf\b/i.test(t)) return null;

  return null;
}

function inferCommonExpenses(text) {
  const t = normalizeText(text);

  const gcMatch =
    t.match(/gastos?\s+comunes?.{0,20}\$?\s*([\d\.\,]+)/i) ||
    t.match(/\bgc\b.{0,15}\$?\s*([\d\.\,]+)/i);

  return gcMatch ? extractNumber(gcMatch[1]) : 0;
}

function extractCardsFromPortal($, sourceUrl) {
  const items = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const absUrl = href.startsWith("http")
      ? href
      : `https://www.portalinmobiliario.com${href}`;

    if (!absUrl.includes("portalinmobiliario.com")) return;

    const anchorText = normalizeText($(el).text());
    const cardText = normalizeText($(el).closest("li, article, div").text());
    const combined = normalizeText(`${anchorText} ${cardText}`);

    if (combined.length < 25) return;
    if (seen.has(absUrl)) return;

    const looksLikeListing =
      combined.includes("dormitorio") ||
      combined.includes("baño") ||
      combined.includes("m²") ||
      combined.includes("$");

    if (!looksLikeListing) return;

    seen.add(absUrl);

    items.push({
      source: "portalinmobiliario",
      sourceUrl,
      url: absUrl,
      rawText: combined
    });
  });

  return items;
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

app.get("/", (req, res) => {
  res.send("Scraper real Portal Inmobiliario funcionando 🚀");
});

app.post("/search", async (req, res) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...(req.body || {})
  };

  try {
    const targets = buildTargets();
    let allItems = [];

    for (const target of targets) {
      try {
        const html = await fetchHtml(target.url);
        const $ = cheerio.load(html);
        const rows = extractCardsFromPortal($, target.url);
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
      count: unique.length,
      items: unique
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
