export interface ProductEntry {
  sku: string;
  ean: string;
  prices: Record<string, { beforeDiscount: number; afterDiscount: number }>;
  stock: number;
  collectionHours: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

export function buildXml(products: ProductEntry[], countries: string[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<products>");

  for (const product of products) {
    lines.push("  <product>");
    lines.push(`    <sku>${escapeXml(product.sku)}</sku>`);
    lines.push(`    <ean>${escapeXml(product.ean)}</ean>`);

    for (const country of countries) {
      const priceData = product.prices[country] ?? { beforeDiscount: 0, afterDiscount: 0 };
      lines.push(`    <price-before-discount-${country}>${formatPrice(priceData.beforeDiscount)}</price-before-discount-${country}>`);
      lines.push(`    <price-after-discount-${country}>${formatPrice(priceData.afterDiscount)}</price-after-discount-${country}>`);
    }

    lines.push(`    <stock>${product.stock}</stock>`);
    lines.push(`    <collectionhours>${product.collectionHours}</collectionhours>`);
    lines.push("  </product>");
  }

  lines.push("</products>");
  return lines.join("\n");
}
