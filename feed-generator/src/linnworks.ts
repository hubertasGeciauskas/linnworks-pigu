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
  Variations: [];
}

export interface InventoryPrice {
  Source: string;
  SubSource: string;
  Price: number;
  Tag?: string | null;
}

interface AuthResponse {
  Token: string;
  Server: string;
}

interface GetStockItemsResponse {
  Items: StockItem[];
  TotalItems: number;
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
      const params = new URLSearchParams({
        request: JSON.stringify({
          keyword: "",
          loadCompositeParents: false,
          loadVariationParents: false,
          entriesPerPage: pageSize,
          pageNumber,
          dataRequirements: [0, 1, 4, 8],
          searchTypes: [0, 1, 2],
        }),
      });

      const response = await this.session.post<GetStockItemsResponse>(
        "/api/Stock/GetStockItemsFull",
        params.toString()
      );

      const { Items, TotalItems } = response.data;
      totalItems = TotalItems;

      for (const item of Items) {
        allItems.push({
          StockItemId: item.StockItemId,
          ItemNumber: item.ItemNumber,
          BarcodeNumber: item.BarcodeNumber,
          Tags: item.Tags,
          Variations: [],
        });
      }

      totalFetched += Items.length;
      console.log(`  Fetched ${totalFetched} / ${totalItems} items`);
      pageNumber++;

      if (Items.length === 0) break;
    }

    return allItems;
  }

  async getStockLevels(stockItemIds: string[]): Promise<Map<string, number>> {
    console.log(`Fetching stock levels for ${stockItemIds.length} items...`);

    const levelMap = new Map<string, number>();

    const params = new URLSearchParams({
      stockItemIds: JSON.stringify(stockItemIds),
    });

    const response = await this.session.post<RawStockLevel[]>(
      "/api/Stock/GetStockLevel",
      params.toString()
    );

    for (const level of response.data) {
      const qty = level.Available ?? level.StockLevel ?? 0;
      levelMap.set(level.StockItemId, Math.max(0, qty));
    }

    return levelMap;
  }

  async getInventoryItemPrices(stockItemId: string): Promise<InventoryPrice[]> {
    const response = await this.session.get<InventoryPrice[]>(
      "/api/Inventory/GetInventoryItemPrices",
      {
        params: {
          inventoryItemId: stockItemId,
        },
      }
    );

    return Array.isArray(response.data) ? response.data : [];
  }
}
