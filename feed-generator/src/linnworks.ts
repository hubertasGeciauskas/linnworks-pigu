import axios, { type AxiosInstance } from "axios";

const LINNWORKS_AUTH_URL = "https://api.linnworks.net/api/Auth/AuthorizeByApplication";

export interface LinnworksConfig {
  applicationId: string;
  applicationSecret: string;
  token: string;
}

export interface StockLevelInfo {
  Available?: number;
  StockLevel?: number;
}

export interface ChannelPriceInfo {
  Source?: string;
  SubSource?: string;
  Price?: number;
  Tag?: string | null;
  StockItemId?: string;
}

export interface StockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  RetailPrice: number;
  StockLevels: StockLevelInfo[];
  ItemChannelPrices: ChannelPriceInfo[];
  Variations: StockVariation[];
}

export interface StockVariation {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  RetailPrice: number;
  StockLevels: StockLevelInfo[];
  ItemChannelPrices: ChannelPriceInfo[];
}

interface AuthResponse {
  Token: string;
  Server: string;
}

interface RawStockLevel {
  Available?: number;
  StockLevel?: number;
}

interface RawChannelPrice {
  Source?: string;
  SubSource?: string;
  Price?: number;
  Tag?: string | null;
  StockItemId?: string;
}

interface RawStockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber?: string;
  Tags?: string | null;
  RetailPrice?: number;
  StockLevels?: RawStockLevel[];
  ItemChannelPrices?: RawChannelPrice[];
  ChildItems?: RawStockItem[];
  IsVariationGroup?: boolean;
  IsVariationParent?: boolean;
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
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log(`Authenticated. Server: ${response.data.Server}`);
    return new LinnworksClient(response.data.Server, response.data.Token);
  }

  async getAllStockItems(): Promise<StockItem[]> {
    console.log("Fetching all stock items from Linnworks...");

    const pageSize = 200;
    let pageNumber = 1;
    const allItems: StockItem[] = [];

    while (true) {
      const params = new URLSearchParams();

      params.append("keyword", "");
      params.append("loadCompositeParents", "false");
      params.append("loadVariationParents", "false");
      params.append("entriesPerPage", String(pageSize));
      params.append("pageNumber", String(pageNumber));
      params.append("dataRequirements", JSON.stringify([0, 1, 4, 8]));
      params.append("searchTypes", JSON.stringify([0, 1, 2]));

      const response = await this.session.post<RawStockItem[]>(
        "/api/Stock/GetStockItemsFull",
        params.toString()
      );

      const items = Array.isArray(response.data) ? response.data : [];

      console.log(`  Page ${pageNumber}: ${items.length} items`);

      for (const raw of items) {
        if (
          (raw.IsVariationGroup || raw.IsVariationParent) &&
          raw.ChildItems &&
          raw.ChildItems.length > 0
        ) {
          for (const child of raw.ChildItems) {
            allItems.push(this.mapStockItem(child));
          }
        } else {
          allItems.push(this.mapStockItem(raw));
        }
      }

      if (items.length < pageSize) {
        break;
      }

      pageNumber++;
    }

    console.log(`Total stock items fetched: ${allItems.length}`);
    return allItems;
  }

  async getInventoryItemPrices(stockItemId: string): Promise<ChannelPriceInfo[]> {
    console.log(`Fetching inventory item prices for StockItemId: ${stockItemId}`);

    const params = new URLSearchParams();
    params.append("inventoryItemId", stockItemId);

    const response = await this.session.get<ChannelPriceInfo[]>(
      "/api/Inventory/GetInventoryItemPrices",
      {
        params,
      }
    );

    const data = response.data;
    return Array.isArray(data) ? data : [];
  }

  async enrichWithInventoryPrices(item: StockItem): Promise<StockItem> {
    const prices = await this.getInventoryItemPrices(item.StockItemId);

    return {
      ...item,
      ItemChannelPrices: prices,
    };
  }

  getAvailableStock(item: StockItem): number {
    if (!item.StockLevels || item.StockLevels.length === 0) {
      return 0;
    }

    return item.StockLevels.reduce((sum, level) => {
      const qty = level.Available ?? level.StockLevel ?? 0;
      return sum + Math.max(0, Number(qty));
    }, 0);
  }

  getChannelPrice(item: StockItem, source: string, subSource: string): number | null {
    const match = item.ItemChannelPrices.find(
      (price) => price.Source === source && price.SubSource === subSource
    );

    if (!match || match.Price === undefined || match.Price === null) {
      return null;
    }

    return Number(match.Price);
  }

  logChannelPrices(item: StockItem): void {
    console.log(`\nChannel price diagnostic for SKU: ${item.ItemNumber}`);
    console.log(`StockItemId: ${item.StockItemId}`);
    console.log(`RetailPrice: ${item.RetailPrice}`);
    console.log(`ItemChannelPrices count: ${item.ItemChannelPrices.length}`);

    if (item.ItemChannelPrices.length === 0) {
      console.log("  No ItemChannelPrices returned for this SKU.");
      return;
    }

    for (const price of item.ItemChannelPrices) {
      console.log(
        `  Source: ${price.Source ?? ""} | SubSource: ${price.SubSource ?? ""} | Price: ${
          price.Price ?? ""
        } | Tag: ${price.Tag ?? ""}`
      );
    }
  }

  private mapStockItem(raw: RawStockItem): StockItem {
    return {
      StockItemId: raw.StockItemId,
      ItemNumber: raw.ItemNumber,
      BarcodeNumber: raw.BarcodeNumber ?? "",
      Tags: raw.Tags ?? null,
      RetailPrice: Number(raw.RetailPrice ?? 0),
      StockLevels: raw.StockLevels ?? [],
      ItemChannelPrices: raw.ItemChannelPrices ?? [],
      Variations: [],
    };
  }

  async getChannelListings(source: string, subSource: string): Promise<Map<string, number>> {
    console.log(
      `getChannelListings is disabled. Channel prices should be read from GetInventoryItemPrices. Requested: ${source}/${subSource}`
    );

    return new Map<string, number>();
  }
}
