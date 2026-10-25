# First full ingest run and data-quality check (T076)

**Date:** 2026-10-23 · **Source:** UPCitemdb trial API · **Database:** a fresh local Postgres
with every migration applied (not the team's Supabase; the nightly job will fill that once
`SYNC_DATABASE_URL` is set, see README "Product data sync").

## How it was run

```sh
# from backend/, with DATABASE_URL pointing at the fresh database
uv run python -m scripts.sync_products --include-stored --limit 90
uv run python -m scripts.check_data_quality --count 20
```

`scripts/catalog_barcodes.txt` listed 32 barcodes: the 18 from the T022 spike plus 14 popular
products from `scripts/demo_products.csv` (Doritos, Oreo, Goldfish, Cheerios, Heinz, Gatorade,
Crest, Dove, Dawn, ...), found with UPCitemdb's search.

## Run record (`ingest_runs`)

| Run | Status | Started (UTC) | Finished (UTC) | Fetched | Rejected | Inserted | Failed |
| --- | ------ | ------------- | -------------- | ------- | -------- | -------- | ------ |
| 1 | succeeded | 18:43:51 | 18:54:17 | 32 | 0 | 32 | 0 |

Issues flagged in run 1: `price_spread` 15, `no_size` 6, `no_price` 5, `no_category` 5,
`no_image` 3, `size_unrecognized` 3.

## What the run taught us (fixed in this PR)

- **Rate limit.** Lookups 10 s apart still got `TOO_FAST`, so the connector now waits 20 s, and
  the nightly job's timeout is 45 minutes (90 lookups take about 30).
- **Size field is unreliable.** "Pepperidge Farm Goldfish Crackers 72 Count" had a size field of
  "9.00 pounds" (a shipping weight), so it was stored as "9 lb". The size printed in the name now
  wins over the size field. The products were re-cleaned from their stored `raw_payload` (no new
  lookups): Goldfish is now "72 ct", and `size_unrecognized` dropped to 0.

## Spot check of 20 products

Spot check of 20 imported products: 14 passed, 6 with problems.

| # | Barcode | Name | Size | Price | Photo | Result |
| - | ------- | ---- | ---- | ----- | ----- | ------ |
| 1 | 012000171956 | Diet Pepsi Cola Soda Pop 16.9 fl oz 6 Pack Bottles | 16.9 fl oz | $2.50 | yes | OK |
| 2 | 175313080206 | Folgers Classic Roast Ground Coffee, Medium Roast Coffee, 30.5 Ounce Canister | 30.5 oz | $25.98 | yes | OK |
| 3 | 019320015403 | OREO COOKIES-SLEEVE PACK 1X0.78 OZ | 0.78 oz | $18.63 | yes | name is all capitals |
| 4 | 012000171864 | Diet Pepsi Cola Soda Pop 12 fl oz 12 Pack Cans | 12 fl oz | $3.50 | yes | OK |
| 5 | 034000440030 | Reeses Peanut Butter Cup Bar | - | $1.09 | - | no size; no photo |
| 6 | 051500075548 | Jif Honey Creamy Peanut Butter Spread & Honey, 18 oz | 18 oz | $2.48 | yes | OK |
| 7 | 014100135395 | Pepperidge Farm Goldfish Crackers 72 Count | 72 ct | $4.99 | yes | OK |
| 8 | 850019606157 | It's Skinny Fettuccini Pasta - 9.52oz | 9.52 oz | $2.99 | yes | OK |
| 9 | 012000171741 | Diet Pepsi Cola Soda- 20 fl oz Bottle | 20 fl oz | $1.59 | yes | OK |
| 10 | 037000889427 | Crest 3D White Brilliance Whitening Toothpaste with Stain Protection 4.1 oz | 4.1 oz | - | yes | no price |
| 11 | 165982859982 | (2 Pack) Heinz Tomato Ketchup, 32 oz Bottle | 32 oz | $35.00 | yes | OK |
| 12 | 052000328684 | Gatorade Thirst Quencher Lemon-Lime Sports Drink 20 Fluid Ounce Plastic Bottle | 20 fl oz | - | yes | no price |
| 13 | 884912429292 | Snoop Cereal Fruity Hoopz Marshmallow Breakfast Cereal Marshmallow Cereal 12 OZ Box | 12 oz | $3.29 | yes | OK |
| 14 | 860002152448 | Three Wishes Gluten Free Cinnamon Grain-Free Breakfast Cereal - 8.6oz | 8.6 oz | $5.59 | yes | OK |
| 15 | 028400044035 | Doritos Nacho Cheesier Chips - 50 / 1 Ounce | 1 oz | $7.02 | yes | OK |
| 16 | 030772011584 | Dawn Ultra Dishwashing Liquid Dish Soap - Original - 38 fl oz | 38 fl oz | $4.99 | yes | OK |
| 17 | 049000418347 | Coca-Cola Classic Soda 16.9 Ounce (24 Bottles) | 16.9 oz | $1.95 | yes | OK |
| 18 | 798235678735 | Pepsi Cola - 24/16.9 oz. bottles | 16.9 oz | $48.40 | - | no photo |
| 19 | 4002293401102 | Wusthof Gourmet 3-Inch Serrated Paring Knife | - | $12.99 | yes | no size |
| 20 | 850019606140 | It's Skinny Spaghetti Pasta - 9.52oz | 9.52 oz | $2.99 | yes | OK |

Photos were loaded for real: every product with a photo returned an image.

## Findings

- **Names: correct** for all 20, matching the product the barcode belongs to. One is in all
  capitals ("OREO COOKIES-SLEEVE PACK 1X0.78 OZ"); readable, but worth tidying by hand.
- **Photos: 18 of 20 load** and show the product. Two products have no https photo
  (Reese's, Pepsi 24-pack); the app shows its "No image available" placeholder.
- **Sizes: 18 of 20** after the fix above. The paring knife and Reese's have no size anywhere in
  the source.
- **Prices: not reliable enough to call correct.** UPCitemdb's price is the lowest *online* offer
  it has ever recorded, not a shelf price. Two are missing (Crest, Gatorade, shown as "No price
  yet"), and several don't match the pack in the name: Coca-Cola 24 bottles at $1.95 (a single
  bottle's price), Heinz 2-pack at $35.00, an Oreo sleeve at $18.63. 15 of 32 products are
  flagged `price_spread` because the source's own highest and lowest prices differ more than
  tenfold.

## Recommendations for the team

1. **Prices need another source** for the demo (T036 decision with the mentor): MCCS shelf prices
   if the sponsor can share any, or prices entered by admins (T091, with the T089 override flag so
   the nightly sync doesn't overwrite them).
2. Until then, check the `price_spread` products before the demo: the sync logs each one by name
   ("012000171741 Diet Pepsi ...: price_spread"). Re-run `check_data_quality --seed <anything>`
   for another random sample.
3. Add photos for the two products without one via the admin screen (T085).
