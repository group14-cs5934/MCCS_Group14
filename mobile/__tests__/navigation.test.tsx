import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// T003 acceptance: tapping each tab opens the correct screen, and back returns to the
// previous screen.

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
    expect(screen.getByText(/barcode scanner/)).toBeOnTheScreen();

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
    expect(screen).toHavePathname('/product/sample-lays');
    expect(screen.getByText('Product sample-lays')).toBeOnTheScreen();

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
    fireEvent.press(screen.getByText('Open a search result'));
    expect(screen).toHavePathname('/product/sample-cheerios');

    act(() => router.back());
    expect(screen).toHavePathname('/search');
    act(() => router.back());
    expect(screen).toHavePathname('/');
  });
});
