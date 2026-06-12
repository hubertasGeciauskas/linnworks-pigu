import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { LinnworksClient } from "./linnworks.js";
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
  const configPath = resolve(ROOT, "config.json");
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as Config;
}

function getLinnworksCredentials() {
  const applicationId = process.env["LINNWORKS_APP_ID"];
  const applicationSecret = process.env["LINNWORKS_APP_SECRET"];
  const token = process.env["LINNWORKS_TOKEN"];

  if (!applicationId || !applicationSecret || !token) {
    console.error(
      "Missing required environment variables:\n" +
        "  LINNWORKS_APP_ID\n" +
        "  LINNWORKS_APP_SECRET\n" +
        "  LINNWORKS_TOKEN\n\n" +
        "Set these in GitHub Secrets (for CI) or as local environment variables."
    );
    process.exit(1);
  }

  return { applicationId, applicationSecret, token };
}

function parseItemTags(rawTags: string | null): string[] {
  if (!rawTags) return [];
  return rawTags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function applyDiscount(price: number, tags: string[], discountRules: Record<string, number>): number {
  for (const tag of tags) {
    if (tag in discountRules) {
      const pct = discountRules[tag]!;
      return parseFloat((price * (1 - pct / 100)).toFixed(2));
    }
  }
  return price;
}

async function main() {
  console.log("=== Pigu / Octopia Feed Generator ===\n");

  const config = loadConfig();
  const credentials = getLinnworksCredentials();
  const countries = Object.keys(config.countries);

  console.log(`Countries: ${countries.join(", ")}`);
  console.log(`Collection hours: ${config.collectionHours}`);
  console.log(`Discount rules: ${JSON.stringify(config.discountRules)}\n`);

  const client = await LinnworksClient.authenticate(credentials);

  const [stockItems, ...channelPriceMaps] = await Promise.all([
    client.getAllStockItems(),
    ...countries.map((country) => {
      const { source, subSource } = config.countries[country]!;
      return client.getChannelListings(source, subSource);
    }),
  ]);

  const countryPriceMap: Record<string, Map<string, number>> = {};
  countries.forEach((country, idx) => {
    countryPriceMap[country] = channelPriceMaps[idx]!;
  });

  const stockItemIds = stockItems.map((item) => item.StockItemId);
  const stockLevelMap = await client.getStockLevels(stockItemIds);

  console.log("\nBuilding XML feed...");

  const products: ProductEntry[] = [];

  for (const item of stockItems) {
    const sku = item.ItemNumber ?? "";
    const ean = item.BarcodeNumber ?? "";
    const tags = parseItemTags(item.Tags);
    const stockQty = stockLevelMap.get(item.StockItemId) ?? 0;

    const prices: ProductEntry["prices"] = {};
    for (const country of countries) {
      const priceMap = countryPriceMap[country]!;
      const beforeDiscount = priceMap.get(sku) ?? 0;
      const afterDiscount = applyDiscount(beforeDiscount, tags, config.discountRules);
      prices[country] = { beforeDiscount, afterDiscount };
    }

    products.push({
      sku,
      ean,
      prices,
      stock: stockQty,
      collectionHours: config.collectionHours,
    });
  }

  console.log(`Total products in feed: ${products.length}`);

  const xml = buildXml(products, countries);

  const outputDir = resolve(ROOT, "public");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "feed.xml");
  writeFileSync(outputPath, xml, "utf-8");

  console.log(`\nFeed written to: ${outputPath}`);
  console.log(`Feed size: ${(xml.length / 1024).toFixed(1)} KB`);
  console.log("\nDone.");
}

main().catch((err: unknown) => {
  console.error("Feed generation failed:", err);
  process.exit(1);
});
