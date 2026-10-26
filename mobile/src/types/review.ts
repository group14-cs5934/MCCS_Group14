// Shapes of the reviews API's responses. These mirror backend/app/schemas/review.py; when a backend
// model changes, update the matching type here.

import type { IsoDateTime } from './product';

/** A product review, as listed on the product page. */
export type Review = {
  id: number;
  product_id: number;
  /** Optional headline, up to 100 characters. */
  title: string | null;
  /** The review text, 1 to 2,000 characters. */
  body: string;
  /** Who wrote it, shortened so it doesn't reveal their email, e.g. "a***". */
  author: string;
  /** The author's own 1-5 star rating of the product, if they rated it. */
  stars: number | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** A review as admins see it when moderating (GET /admin/reviews). Mirrors AdminReviewRead. */
export type AdminReview = Review & {
  user_id: string;
  /** The author's full email (admins only). */
  author_email: string | null;
  /** True if an admin hid it from the product page. */
  hidden: boolean;
  /** When it was hidden. */
  hidden_at: IsoDateTime | null;
};

/** One page of a product's reviews, newest first (GET /products/{id}/reviews). */
export type ReviewPage = {
  items: Review[];
  /** How many reviews the product has in all. */
  total: number;
  limit: number;
  offset: number;
};
