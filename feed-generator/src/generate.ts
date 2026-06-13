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
  try {
    return readFileSync(resolve(ROOT, "input-skus.txt"), "utf-8")
      .split(/\r?\n/)
      .map((sku) => sku.trim())
      .filter(Boolean);
  } catch {
    console.log("No input-skus.txt found. Exporting all products.");
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
  return rawTags.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function applyDiscount(price: number, tags: string[], discountRules: Record<string, number>): number {
  for (const tag of tags) {
    if (tag in discountRules) {
      return Number((price * (1 - discountRules[tag]! / 100)).toFixed(2));
    }
  }
  return price;
}

function getAvailableStock(item: StockItem): number {
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

  const client = await LinnworksClient.authenticate(getLinnworksCredentials());
  const allStockItems = await client.getAllStockItems();

  const stockItems =
    inputSkus.length > 0
      ? allStockItems.filter((item) => inputSkus.includes(item.ItemNumber))
      : allStockItems;

  const products: ProductEntry[] = [];
  const skippedProducts: string[] = [];

  for (const baseItem of stockItems) {
    const item = await client.enrichWithInventoryPrices(baseItem);

    const sku = item.ItemNumber ?? "";
    const ean = item.BarcodeNumber ?? "";
    const tags = parseItemTags(item.Tags);
    const stockQty = getAvailableStock(item);

    const prices: ProductEntry["prices"] = {};
    let hasAllPrices = true;

    for (const country of countries) {
      const { source, subSource } = config.countries[country]!;
      const channelPrice = client.getChannelPrice(item, source, subSource);

      if (channelPrice === null) {
        hasAllPrices = false;
        console.warn(`Skipping ${sku}: missing ${country} price for ${source} / ${subSource}`);
        break;
      }

      prices[country] = {
        beforeDiscount: channelPrice,
        afterDiscount: applyDiscount(channelPrice, tags, config.discountRules),
      };
    }

    if (!hasAllPrices) {
      skippedProducts.push(sku);
      continue;
    }

    products.push({
      sku,
      ean,
      prices,
      stock: stockQty,
      collectionHours: config.collectionHours,
    });
  }

  const outputDir = ROOT;
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(resolve(outputDir, "feed.xml"), buildXml(products, countries), "utf-8");

  const status = {
    generatedAt: new Date().toISOString(),
    inputSkuMode: inputSkus.length > 0,
    inputSkuCount: inputSkus.length,
    productsSelected: stockItems.length,
    productsExported: products.length,
    productsSkipped: skippedProducts.length,
    skippedSkus: skippedProducts,
  };

  writeFileSync(resolve(outputDir, "status.json"), JSON.stringify(status, null, 2), "utf-8");

  console.log("\n=== Summary ===");
  console.log(`Products selected: ${stockItems.length}`);
  console.log(`Products exported: ${products.length}`);
  console.log(`Products skipped: ${skippedProducts.length}`);
}

main().catch((error) => {
  console.error("Feed generation failed:", error);
  process.exit(1);
});
