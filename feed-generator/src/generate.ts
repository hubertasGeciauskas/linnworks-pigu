import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { LinnworksClient, type StockItem } from "./linnworks.js";
import { buildXml, type ProductEntry } from "./xml-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface CountryConfig {
  source: string;
  subSource: string;
}

interface Config {
  collectionHours: number;
  countries: Record<string, CountryConfig>;
  discountRules: Record<string, number>;
}

function loadConfig(): Config {
  return JSON.parse(readFileSync(resolve(ROOT, "config.json"), "utf-8")) as Config;
}

function loadInputSkus(): string[] {
  const path = resolve(ROOT, "input-skus.txt");

  try {
    return readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .map((sku) => sku.trim())
      .filter(Boolean);
  } catch {
    console.log("No input-skus.txt found. Using all products.");
    return [];
  }
}

function getLinnworksCredentials() {
  const applicationId = process.env["LINNWORKS_APP_ID"];
  const applicationSecret = process.env["LINNWORKS_APP_SECRET"];
  const token = process.env["LINNWORKS_TOKEN"];

  if (!applicationId || !applicationSecret || !token) {
    throw new Error("Missing Linnworks environment variables.");
  }

  return { applicationId, applicationSecret, token };
}

function parseItemTags(rawTags: string | null): string[] {
  if (!rawTags) return [];

  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function applyDiscount(price: number, tags: string[], discountRules: Record<string, number>): number {
  for (const tag of tags) {
    if (tag in discountRules) {
      const pct = discountRules[tag]!;
      return Number((price * (1 - pct / 100)).toFixed(2));
    }
  }

  return price;
}

function getAvailableStock(item: StockItem): number {
  if (!item.StockLevels || item.StockLevels.length === 0) {
    return 0;
  }

  return item.StockLevels.reduce((sum, level) => {
    const qty = level.Available ?? level.StockLevel ?? 0;
    return sum + Math.max(0, Number(qty));
  }, 0);
}

async function main() {
  console.log("=== Pigu / Octopia Feed Generator ===\n");

  const config = loadConfig();
  const countries = Object.keys(config.countries);
  const inputSkus = loadInputSkus();

  console.log(`Countries: ${countries.join(", ")}`);
  console.log(`Collection hours: ${config.collectionHours}`);
  console.log(`Discount rules: ${JSON.stringify(config.discountRules)}`);

  if (inputSkus.length > 0) {
    console.log(`Input SKU mode enabled. SKUs: ${inputSkus.join(", ")}`);
  } else {
    console.log("Input SKU mode disabled. Exporting all products.");
  }

  const client = await LinnworksClient.authenticate(getLinnworksCredentials());

  const allStockItems = await client.getAllStockItems();

  const stockItems =
    inputSkus.length > 0
      ? allStockItems.filter((item) => inputSkus.includes(item.ItemNumber))
      : allStockItems;

  const foundSkus = new Set(stockItems.map((item) => item.ItemNumber));

  for (const sku of inputSkus) {
    if (!foundSkus.has(sku)) {
      console.warn(`WARNING: SKU not found in Linnworks inventory: ${sku}`);
    }
  }

  console.log(`Products selected for feed: ${stockItems.length}`);

  const products: ProductEntry[] = [];

  for (const item of stockItems) {
    client.logChannelPrices(item);

    const sku = item.ItemNumber ?? "";
    const ean = item.BarcodeNumber ?? "";
    const tags = parseItemTags(item.Tags);
    const stockQty = getAvailableStock(item);
    const retailPrice = Number(item.RetailPrice ?? 0);

    console.log(`\nProduct: ${sku}`);
    console.log(`StockItemId: ${item.StockItemId}`);
    console.log(`EAN: ${ean}`);
    console.log(`RetailPrice: ${retailPrice}`);
    console.log(`Stock: ${stockQty}`);

    const prices: ProductEntry["prices"] = {};

    for (const country of countries) {
      const beforeDiscount = retailPrice;
      const afterDiscount = applyDiscount(beforeDiscount, tags, config.discountRules);

      prices[country] = {
        beforeDiscount,
        afterDiscount,
      };
    }

    products.push({
      sku,
      ean,
      prices,
      stock: stockQty,
      collectionHours: config.collectionHours,
    });
  }

  const xml = buildXml(products, countries);

  const outputDir = resolve(ROOT, "public");
  mkdirSync(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, "feed.xml");
  writeFileSync(outputPath, xml, "utf-8");

  console.log("\n=== Summary ===");
  console.log(`Products exported: ${products.length}`);
  console.log(`Feed written to: ${outputPath}`);
}

main().catch((error) => {
  console.error("Feed generation failed:", error);
  process.exit(1);
});
