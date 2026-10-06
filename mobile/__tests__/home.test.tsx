import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// T016 acceptance: when the app opens, the home screen shows Scan and Search entry points.

describe('home screen', () => {
  it('opens on Home with Scan and Search entry points', async () => {
    renderRouter('src/app');

    expect(screen).toHavePathname('/');
    expect(await screen.findByText('Scan & compare.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Scan Product' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search manually' })).toBeOnTheScreen();
  });

  it('opens the Scan tab from Scan Product', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Scan Product' }));
    expect(screen).toHavePathname('/scan');
  });

  it('opens Search from Search manually', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Search manually' }));
    expect(screen).toHavePathname('/search');
  });
});
