import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// T003 acceptance: tapping each tab opens the correct screen, and back returns to the
// previous screen.

// These tests are about navigation only, so the product page never calls the API: it just
// shows its loading spinner.
jest.mock('@/hooks/useProduct', () => ({
  useProduct: () => ({ loading: true, product: null, error: null, reload: () => {} }),
}));

// Search never calls the API either: it always has one result, Cheerios (ID 42).
jest.mock('@/hooks/useProductSearch', () => ({
  ...jest.requireActual('@/hooks/useProductSearch'),
  useProductSearch: () => ({
    query: 'cheerios',
    loading: false,
    results: [{ id: 42, name: 'Cheerios' }],
    error: null,
    reload: () => {},
  }),
}));

/** Tab bar buttons are announced as e.g. "Scan, tab, 2 of 3". */
const tab = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, tab`) });

describe('navigation shell', () => {
  it('opens the correct screen for each tab', async () => {
    renderRouter('src/app');
    expect(screen).toHavePathname('/');

    await screen.findByText('Scan & compare.');
    fireEvent.press(tab('Scan'));
    expect(screen).toHavePathname('/scan');
    expect(tab('Scan')).toBeSelected();
    expect(screen.getByText('Allow camera access')).toBeOnTheScreen();

    fireEvent.press(tab('Saved'));
    expect(screen).toHavePathname('/saved');
    expect(tab('Saved')).toBeSelected();
    expect(screen.getByText('Saved Products')).toBeOnTheScreen();

    fireEvent.press(tab('Home'));
    expect(screen).toHavePathname('/');
    expect(screen.getByText('Scan & compare.')).toBeOnTheScreen();
  });

  it('returns to Home when going back from a product', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByText('Open a sample product'));
    expect(screen).toHavePathname('/product/1');
    expect(screen.getByText('Loading product…')).toBeOnTheScreen();

    act(() => router.back());
    expect(screen).toHavePathname('/');
  });

  it('returns to the tab the product was opened from', async () => {
    renderRouter('src/app');

    await screen.findByText('Scan & compare.');
    fireEvent.press(tab('Saved'));
    fireEvent.press(screen.getByText('Open a saved product'));
    expect(screen).toHavePathname('/product/sample-oatly');

    act(() => router.back());
    expect(screen).toHavePathname('/saved');
  });

  it('goes back through search to the product and then Home', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByText('Search manually'));
    expect(screen).toHavePathname('/search');
    fireEvent.press(screen.getByText('Cheerios'));
    expect(screen).toHavePathname('/product/42');

    act(() => router.back());
    expect(screen).toHavePathname('/search');
    act(() => router.back());
    expect(screen).toHavePathname('/');
  });
});
