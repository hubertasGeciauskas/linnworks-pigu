# Pigu / Octopia Feed Generator

Generates a stock and price XML feed from the Linnworks API, published via GitHub Pages every 3 hours.

---

## Quick Start

```bash
cd feed-generator

# Install dependencies
pnpm install

# Set credentials (see below), then run:
LINNWORKS_APP_ID=xxx LINNWORKS_APP_SECRET=yyy LINNWORKS_TOKEN=zzz pnpm run generate
```

The feed is written to `feed-generator/public/feed.xml`.

---

## Linnworks Credentials

You need three values from your Linnworks developer account:

| Variable | Description |
|---|---|
| `LINNWORKS_APP_ID` | Application ID from Linnworks developer portal |
| `LINNWORKS_APP_SECRET` | Application Secret from Linnworks developer portal |
| `LINNWORKS_TOKEN` | Installation Token for your Linnworks account |

To obtain these:
1. Log in to Linnworks and go to **Settings → Apps → Developer Apps**.
2. Create or open your application.
3. Copy **Application ID** and **Application Secret**.
4. Click **Install** on your account and copy the **Installation Token**.

---

## GitHub Secrets Setup

1. Open your repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** and add each of the following:
   - `LINNWORKS_APP_ID`
   - `LINNWORKS_APP_SECRET`
   - `LINNWORKS_TOKEN`

---

## GitHub Actions

The workflow file is at `.github/workflows/generate-feed.yml`.

It runs automatically:
- **Every 3 hours** (via cron: `0 */3 * * *`)
- **Manually** — go to **Actions → Generate Pigu Feed → Run workflow**

After each run the updated `feed-generator/public/feed.xml` is committed and pushed back to the repository automatically.

---

## GitHub Pages Setup

GitHub Pages serves the `public/` folder as a static site, making the feed available at a public URL.

1. Push your repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Set **Branch** to `main` (or your default branch).
5. Set **Folder** to `/feed-generator/public`.
6. Click **Save**.

Your feed will be available at:
```
https://<your-username>.github.io/<repo-name>/feed.xml
```

> **Note:** GitHub Pages may take 1–2 minutes to update after a new commit.

---

## Editing `config.json`

The file `feed-generator/config.json` controls all feed settings — no code changes needed.

```json
{
  "collectionHours": 24,
  "countries": {
    "lt": { "source": "PIGU", "subSource": "pigu_lt" },
    "lv": { "source": "PIGU", "subSource": "pigu_lv" },
    "ee": { "source": "PIGU", "subSource": "pigu_ee" },
    "fi": { "source": "PIGU", "subSource": "pigu_fi" }
  },
  "discountRules": {
    "PIGU_10": 10,
    "PIGU_15": 15,
    "PIGU_20": 20
  }
}
```

### `collectionHours`
How many hours for order collection, written into the `<collectionhours>` field of every product.

### `countries`
Each key is the country code used in the XML field names (e.g. `lt` → `<price-before-discount-lt>`).
- **source** — Linnworks channel Source name (e.g. `PIGU`)
- **subSource** — Linnworks channel SubSource name (e.g. `pigu_lt`)

To add a new country, add a new entry:
```json
"pl": { "source": "PIGU", "subSource": "pigu_pl" }
```

To remove a country, delete its entry. The XML output adjusts automatically.

### `discountRules`
Maps a Linnworks product **tag** to a discount percentage. If a product has a matching tag, `<price-after-discount-*>` is reduced by that percentage. Multiple discount tags on one product — the **first match wins**.

```json
"PIGU_10": 10   ← tag "PIGU_10" → 10% off
"PIGU_25": 25   ← tag "PIGU_25" → 25% off
```

If no matching tag is found, `price-after-discount` equals `price-before-discount`.

---

## XML Output Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<products>
  <product>
    <sku>ABC-123</sku>
    <ean>1234567890123</ean>
    <price-before-discount-lt>29.99</price-before-discount-lt>
    <price-after-discount-lt>26.99</price-after-discount-lt>
    <price-before-discount-lv>29.99</price-before-discount-lv>
    <price-after-discount-lv>29.99</price-after-discount-lv>
    <price-before-discount-ee>29.99</price-before-discount-ee>
    <price-after-discount-ee>29.99</price-after-discount-ee>
    <price-before-discount-fi>34.99</price-before-discount-fi>
    <price-after-discount-fi>34.99</price-after-discount-fi>
    <stock>42</stock>
    <collectionhours>24</collectionhours>
  </product>
</products>
```

- All fields are always present, even if price is `0.00`.
- Variation products are each exported as separate `<product>` entries.
- Prices have 2 decimal places.

---

## Local Development

```bash
# Install
cd feed-generator && pnpm install

# Run with real credentials
export LINNWORKS_APP_ID=your_app_id
export LINNWORKS_APP_SECRET=your_app_secret
export LINNWORKS_TOKEN=your_token
pnpm run generate

# Typecheck
pnpm run typecheck
```
