// Review limits, the same as the API's (backend/app/schemas/review.py). Checking them in the app
// shows the problem before anything is sent; the API checks again.
export const REVIEW_TITLE_MAX_LENGTH = 100;
export const REVIEW_BODY_MAX_LENGTH = 2000;

/** Per-field error messages for the review form. Empty means valid. */
export type ReviewErrors = { title?: string; body?: string };

const count = (length: number) => length.toLocaleString('en-US');

export function validateReview(title: string, body: string): ReviewErrors {
  const errors: ReviewErrors = {};
  const titleLength = title.trim().length;
  const bodyLength = body.trim().length;
  if (titleLength > REVIEW_TITLE_MAX_LENGTH) {
    errors.title = `Your title is ${count(titleLength)} characters; keep it to ${REVIEW_TITLE_MAX_LENGTH} or fewer.`;
  }
  if (bodyLength === 0) {
    errors.body = 'Write your review before posting.';
  } else if (bodyLength > REVIEW_BODY_MAX_LENGTH) {
    errors.body = `Your review is ${count(bodyLength)} characters; keep it to ${count(REVIEW_BODY_MAX_LENGTH)} or fewer.`;
  }
  return errors;
}
