import axios, { type AxiosInstance } from "axios";

const LINNWORKS_AUTH_URL = "https://api.linnworks.net/api/Auth/AuthorizeByApplication";

export interface LinnworksConfig {
  applicationId: string;
  applicationSecret: string;
  token: string;
}

export interface StockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  Variations: StockVariation[];
}

export interface StockVariation {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
}

export interface StockLevel {
  StockItemId: string;
  Available: number;
}

interface AuthResponse {
  Token: string;
  Server: string;
}

interface GetStockItemsResponse {
  Items: RawStockItem[];
  TotalItems: number;
}

interface RawStockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  ChildItems?: RawStockItem[];
  IsVariationGroup?: boolean;
}

interface RawStockLevel {
  StockItemId: string;
  Available?: number;
  StockLevel?: number;
}

export class LinnworksClient {
  private session: AxiosInstance;

  private constructor(server: string, token: string) {
    this.session = axios.create({
      baseURL: server,
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  static async authenticate(config: LinnworksConfig): Promise<LinnworksClient> {
    console.log("Authenticating with Linnworks...");

    const params = new URLSearchParams({
      applicationId: config.applicationId,
      applicationSecret: config.applicationSecret,
      token: config.token,
    });

    const response = await axios.post<AuthResponse>(
      LINNWORKS_AUTH_URL,
      params.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const { Token, Server } = response.data;
    console.log(`Authenticated. Server: ${Server}`);

    return new LinnworksClient(Server, Token);
  }

  async getAllStockItems(): Promise<StockItem[]> {
    console.log("Fetching all stock items from Linnworks...");

    const pageSize = 200;
    let pageNumber = 1;
    let totalFetched = 0;
    let totalItems = Infinity;
    const allItems: StockItem[] = [];

    while (totalFetched < totalItems) {
      const params = new URLSearchParams();

      params.append("keyword", "");
      params.append("loadCompositeParents", "false");
      params.append("loadVariationParents", "false");
      params.append("entriesPerPage", String(pageSize));
      params.append("pageNumber", String(pageNumber));
      params.append("dataRequirements", JSON.stringify([0, 1, 4, 8]));
      params.append("searchTypes", JSON.stringify([0, 1, 2]));

      const response = await this.session.post<GetStockItemsResponse>(
        "/api/Stock/GetStockItemsFull",
        params.toString()
      );

      const { Items, TotalItems } = response.data;
      totalItems = TotalItems;

      for (const raw of Items) {
        if (raw.IsVariationGroup && raw.ChildItems && raw.ChildItems.length > 0) {
          for (const child of raw.ChildItems) {
            allItems.push({
              StockItemId: child.StockItemId,
              ItemNumber: child.ItemNumber,
              BarcodeNumber: child.BarcodeNumber,
              Tags: child.Tags,
              Variations: [],
            });
          }
        } else {
          allItems.push({
            StockItemId: raw.StockItemId,
            ItemNumber: raw.ItemNumber,
            BarcodeNumber: raw.BarcodeNumber,
            Tags: raw.Tags,
            Variations: [],
          });
        }
      }

      totalFetched += Items.length;
      console.log(`  Fetched ${totalFetched} / ${totalItems} items`);

      pageNumber++;

      if (Items.length === 0) break;
    }

    console.log(`Total stock items fetched: ${allItems.length}`);
    return allItems;
  }

  async getStockLevels(stockItemIds: string[]): Promise<Map<string, number>> {
    console.log(`Fetching stock levels for ${stockItemIds.length} items...`);

    const batchSize = 200;
    const levelMap = new Map<string, number>();

    for (let i = 0; i < stockItemIds.length; i += batchSize) {
      const batch = stockItemIds.slice(i, i + batchSize);

      const params = new URLSearchParams({
        stockItemIds: JSON.stringify(batch),
      });

      const response = await this.session.post<RawStockLevel[]>(
        "/api/Stock/GetStockLevel",
        params.toString()
      );

      for (const level of response.data) {
        const qty = level.Available ?? level.StockLevel ?? 0;
        levelMap.set(level.StockItemId, Math.max(0, qty));
      }

      console.log(
        `  Stock levels: ${Math.min(i + batchSize, stockItemIds.length)} / ${stockItemIds.length}`
      );
    }

    return levelMap;
  }

  async getChannelListings(source: string, subSource: string): Promise<Map<string, number>> {
    console.log(`Fetching channel prices for ${source} / ${subSource}...`);

    const priceMap = new Map<string, number>();

    const params = new URLSearchParams({
      request: JSON.stringify({
        Source: source,
        SubSource: subSource,
      }),
    });

    const response = await this.session.post<any>(
      "/api/Inventory/GetInventoryItemPriceRulesBySource",
      params.toString()
    );

    const data = response.data;
    const items = Array.isArray(data) ? data : data.Items ?? data.Data ?? [];

    for (const item of items) {
      const sku = item.SKU ?? item.ItemNumber ?? item.StockItemSKU ?? item.StockItemId;
      const price = item.Price ?? item.MainPrice ?? item.RulePrice ?? item.Value ?? 0;

      if (sku) {
        priceMap.set(String(sku), Number(price));
      }
    }

    console.log(`  Total prices for ${source}/${subSource}: ${priceMap.size}`);

    return priceMap;
  }
}
