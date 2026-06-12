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

export interface ChannelListing {
  SKU: string;
  Price: number;
  Source: string;
  SubSource: string;
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

interface RawListing {
  SKU: string;
  Price: number;
  Source: string;
  SubSource: string;
}

interface GetListingsResponse {
  Items?: RawListing[];
  Data?: RawListing[];
}

interface RawStockLevel {
  StockItemId: string;
  Available?: number;
  StockLevel?: number;
}

export class LinnworksClient {
  private session: AxiosInstance;
  private server: string;

  private constructor(server: string, token: string) {
    this.server = server;
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

    const response = await axios.post<AuthResponse>(LINNWORKS_AUTH_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

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

      console.log(`  Stock levels: ${Math.min(i + batchSize, stockItemIds.length)} / ${stockItemIds.length}`);
    }

    return levelMap;
  }

  async getChannelListings(source: string, subSource: string): Promise<Map<string, number>> {
    console.log(`Fetching channel listings for ${source} / ${subSource}...`);
    const pageSize = 500;
    let pageNumber = 1;
    const priceMap = new Map<string, number>();
    let keepFetching = true;

    while (keepFetching) {
      const params = new URLSearchParams({
        request: JSON.stringify({
          Source: source,
          SubSource: subSource,
          PageNumber: pageNumber,
          EntriesPerPage: pageSize,
        }),
      });

      const response = await this.session.post<GetListingsResponse | RawListing[]>(
        "/api/Listings/GetListingsBySource",
        params.toString()
      );

      let items: RawListing[] = [];
      const data = response.data;

      if (Array.isArray(data)) {
        items = data;
      } else if (data && "Items" in data && Array.isArray(data.Items)) {
        items = data.Items;
      } else if (data && "Data" in data && Array.isArray(data.Data)) {
        items = data.Data;
      }

      for (const listing of items) {
        if (listing.SKU) {
          priceMap.set(listing.SKU, listing.Price ?? 0);
        }
      }

      console.log(`  ${source}/${subSource}: page ${pageNumber}, got ${items.length} listings`);

      if (items.length < pageSize) {
        keepFetching = false;
      } else {
        pageNumber++;
      }
    }

    console.log(`  Total listings for ${subSource}: ${priceMap.size}`);
    return priceMap;
  }
}
