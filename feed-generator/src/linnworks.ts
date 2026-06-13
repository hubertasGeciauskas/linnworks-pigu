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

export interface StockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  RetailPrice: number;
  StockLevels: StockLevelInfo[];
  Variations: StockVariation[];
}

export interface StockVariation {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags: string | null;
  RetailPrice: number;
  StockLevels: StockLevelInfo[];
}

interface AuthResponse {
  Token: string;
  Server: string;
}

interface RawStockLevel {
  Available?: number;
  StockLevel?: number;
}

interface RawStockItem {
  StockItemId: string;
  ItemNumber: string;
  BarcodeNumber: string;
  Tags?: string | null;
  RetailPrice?: number;
  StockLevels?: RawStockLevel[];
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

    const pageSize = 500;
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
        if ((raw.IsVariationGroup || raw.IsVariationParent) && raw.ChildItems && raw.ChildItems.length > 0) {
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

  getAvailableStock(item: StockItem): number {
    if (!item.StockLevels || item.StockLevels.length === 0) {
      return 0;
    }

    return item.StockLevels.reduce((sum, level) => {
      const qty = level.Available ?? level.StockLevel ?? 0;
      return sum + Math.max(0, Number(qty));
    }, 0);
  }

  private mapStockItem(raw: RawStockItem): StockItem {
    return {
      StockItemId: raw.StockItemId,
      ItemNumber: raw.ItemNumber,
      BarcodeNumber: raw.BarcodeNumber ?? "",
      Tags: raw.Tags ?? null,
      RetailPrice: Number(raw.RetailPrice ?? 0),
      StockLevels: raw.StockLevels ?? [],
      Variations: [],
    };
  }

  async getChannelListings(source: string, subSource: string): Promise<Map<string, number>> {
    console.log(`Channel pricing disabled for now. Using RetailPrice instead of ${source}/${subSource}.`);
    return new Map<string, number>();
  }
}
