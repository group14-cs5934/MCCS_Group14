// Shapes of the ratings API's responses. These mirror backend/app/schemas/rating.py; when a backend
// model changes, update the matching type here.

/** A product's average rating, from GET /products/{id}/ratings. */
export type RatingSummary = {
  product_id: number;
  /** Mean stars (1 to 5), rounded to 2 decimal places; null until someone rates the product. */
  average: number | null;
  /** How many users rated the product. */
  count: number;
};
