import { render, screen, waitFor } from '@testing-library/react-native';

import OverallReview from '@/components/OverallReview';
import type { OverallReview as OverallReviewData } from '@/types/review';

// T052.8: the product page shows the AI-written overall review from other stores' reviews as a
// section of its own, labelled as written by AI, and shows nothing when a product has none.
// backend/tests/test_overall_review_api.py checks the API side.

const OVERALL: OverallReviewData = {
  product_id: 1,
  overall_review: 'Shoppers like the smooth, mild flavour; a few find it too weak.',
  review_count: 128,
  generated_at: '2026-11-01T12:00:00Z',
  sources: [
    { source: 'mynavyexchange.com', average_stars: 4.6, review_count: 928 },
    { source: 'example.com', average_stars: null, review_count: null },
  ],
};

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const originalFetch = globalThis.fetch;

function respondWith(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

it("shows the product's overall review, labelled as written by AI", async () => {
  respondWith(200, OVERALL);

  render(<OverallReview productId={1} />);

  expect(await screen.findByText(OVERALL.overall_review)).toBeOnTheScreen();
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/products\/1\/overall-review$/);
  expect(screen.getByText('What shoppers say elsewhere')).toBeOnTheScreen();
  expect(screen.getByText('AI summary')).toBeOnTheScreen();
  expect(screen.getByText(/Written by AI from 128 reviews on other stores/)).toBeOnTheScreen();
  expect(screen.getByText(/Updated Nov 1, 2026/)).toBeOnTheScreen();
});

it('lists each store with its own average and review count', async () => {
  respondWith(200, OVERALL);

  render(<OverallReview productId={1} />);

  expect(
    await screen.findByLabelText('mynavyexchange.com, rated 4.6 out of 5, from 928 reviews'),
  ).toBeOnTheScreen();
  expect(screen.getByText('4.6')).toBeOnTheScreen();
  expect(screen.getByText('(928)')).toBeOnTheScreen();
  // A store whose page gives no rating or count is still listed, without them.
  expect(screen.getByLabelText('example.com')).toBeOnTheScreen();
});

it('leaves out the store list when no store totals were saved', async () => {
  respondWith(200, { ...OVERALL, review_count: 1, sources: [] });

  render(<OverallReview productId={1} />);

  expect(await screen.findByText(/Written by AI from 1 review on/)).toBeOnTheScreen();
  expect(screen.queryByText('mynavyexchange.com')).toBeNull();
});

it.each([
  ['has an answer that isn’t an overall review', 200, { id: 1, name: 'Sample Chips' }],
  ['has no overall review yet', 404, { code: 'overall_review_not_found', message: 'None yet' }],
  ["couldn't be loaded", 500, { code: 'internal_error', message: 'Something went wrong' }],
])('shows nothing when the product %s', async (_case, status, body) => {
  respondWith(status, body);

  render(<OverallReview productId={1} />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  // Let the response arrive, then check the card never appeared.
  await waitFor(() => expect(screen.queryByTestId('overall-review')).toBeNull());
  expect(screen.queryByText('AI summary')).toBeNull();
});
