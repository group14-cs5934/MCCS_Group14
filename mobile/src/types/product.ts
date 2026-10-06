// Shapes of the API's JSON responses. These mirror the ...Read models in backend/app/schemas/;
// when a backend model changes, update the matching type here.

/** ISO 8601 date-time string, e.g. "2026-10-06T19:42:59Z". */
export type IsoDateTime = string;

export type Brand = {
  id: number;
  name: string;
};

export type Category = {
  id: number;
  name: string;
  /** Lowercase words joined by hyphens, e.g. "chips-snacks". */
  slug: string;
  description: string | null;
};

export type Price = {
  id: number;
  product_id: number;
  /** Exact decimal as a string so it never loses cents, e.g. "3.49". Don't do math on it as a float. */
  amount: string;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  /** Where the price came from, e.g. "MCCS". */
  source: string | null;
  observed_at: IsoDateTime;
};

export type Product = {
  id: number;
  /** UPC/EAN digits, e.g. "036000291452". */
  barcode: string;
  name: string;
  description: string | null;
  /** e.g. "184g". */
  size: string | null;
  image_url: string | null;
  brand_id: number | null;
  category_id: number | null;
  brand: Brand | null;
  category: Category | null;
  /** Most recent price, if any. */
  price: Price | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};
