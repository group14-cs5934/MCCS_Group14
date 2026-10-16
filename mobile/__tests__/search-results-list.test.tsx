import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import SearchResultsList from '@/components/SearchResultsList';
import type { Product } from '@/types/product';

// T038 acceptance: when results come back, each shows name, price, and photo; tapping one opens
// its product page. (Opening the page from the search screen is in search-screen.test.tsx.)

// Load the icon font up front so the placeholder icon doesn't log act() warnings.
beforeAll(() => Ionicons.loadFont());

const FOLGERS: Product = {
  id: 2,
  barcode: '025500000015',
  name: 'Folgers Classic Roast Coffee',
  description: null,
  size: '25.9 oz',
  image_url: 'https://images.example.com/folgers.jpg',
  brand_id: null,
  category_id: 4,
  brand: null,
  category: { id: 4, name: 'Coffee & Tea', slug: 'coffee-tea', description: null },
  price: {
    id: 9,
    product_id: 2,
    amount: '8.99',
    currency: 'USD',
    source: 'MCCS',
    observed_at: '2026-10-11T19:19:16Z',
  },
  created_at: '2026-10-11T19:19:16Z',
  updated_at: '2026-10-11T19:19:16Z',
};

/** A product with no photo, no price, and no size, only a category. */
const OATLY: Product = {
  ...FOLGERS,
  id: 3,
  name: 'Oatly Oat Milk',
  size: null,
  image_url: null,
  category: { id: 5, name: 'Dairy & Alternatives', slug: 'dairy', description: null },
  price: null,
};

const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

it('shows each result’s name, price, and photo', () => {
  render(<SearchResultsList results={[FOLGERS, OATLY]} onOpen={jest.fn()} />);

  const folgers = within(row('Folgers Classic Roast Coffee'));
  expect(folgers.getByText('Folgers Classic Roast Coffee')).toBeOnTheScreen();
  expect(folgers.getByText('$8.99')).toBeOnTheScreen();
  expect(folgers.getByText('25.9 oz')).toBeOnTheScreen();
  expect(folgers.getByLabelText('Photo of Folgers Classic Roast Coffee')).toHaveProp('source', {
    uri: 'https://images.example.com/folgers.jpg',
  });
});

it('keeps the results in the order given (best match first)', () => {
  render(<SearchResultsList results={[OATLY, FOLGERS]} onOpen={jest.fn()} />);

  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Oatly Oat Milk, Dairy & Alternatives, No price yet',
    'Folgers Classic Roast Coffee, 25.9 oz, $8.99',
  ]);
});

it('shows a placeholder and "No price yet" when a product has no photo or price', () => {
  render(<SearchResultsList results={[OATLY]} onOpen={jest.fn()} />);

  const oatly = within(row('Oatly Oat Milk'));
  expect(oatly.getByText('No price yet')).toBeOnTheScreen();
  expect(oatly.getByText('Dairy & Alternatives')).toBeOnTheScreen(); // category, as there's no size
  expect(oatly.getByTestId('product-photo-placeholder')).toBeOnTheScreen();
  expect(oatly.queryByLabelText(/^Photo of/)).not.toBeOnTheScreen();
});

it('shows the placeholder if the photo fails to load', () => {
  render(<SearchResultsList results={[FOLGERS]} onOpen={jest.fn()} />);

  fireEvent(screen.getByLabelText('Photo of Folgers Classic Roast Coffee'), 'error');

  expect(screen.queryByLabelText('Photo of Folgers Classic Roast Coffee')).not.toBeOnTheScreen();
  expect(screen.getByTestId('product-photo-placeholder')).toBeOnTheScreen();
});

it('reads each result as one item to screen readers', () => {
  render(<SearchResultsList results={[FOLGERS]} onOpen={jest.fn()} />);

  expect(
    screen.getByRole('button', { name: 'Folgers Classic Roast Coffee, 25.9 oz, $8.99' }),
  ).toBeOnTheScreen();
});

it('calls onOpen with the tapped product', () => {
  const onOpen = jest.fn();
  render(<SearchResultsList results={[FOLGERS, OATLY]} onOpen={onOpen} />);

  fireEvent.press(row('Oatly Oat Milk'));

  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith(OATLY);
});

it('shows nothing for no results', () => {
  render(<SearchResultsList results={[]} onOpen={jest.fn()} />);

  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
