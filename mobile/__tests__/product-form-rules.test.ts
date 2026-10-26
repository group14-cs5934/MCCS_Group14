import {
  EMPTY_PRODUCT_FORM,
  createBody,
  editBody,
  stockChanges,
  validateProductForm,
  validateStock,
  type ProductFormValues,
  type StockFormRow,
} from '@/utils/productForm';

// T091: the admin product form's rules, which decide what's sent (and whether anything is).

const COKE: ProductFormValues = {
  barcode: '049000418347',
  name: 'Coca-Cola Classic',
  description: '',
  size: '16.9 fl oz',
  imageUrl: '',
  price: '1.95',
};

describe('validateProductForm', () => {
  it('needs a barcode and a name', () => {
    expect(validateProductForm(EMPTY_PRODUCT_FORM)).toEqual({
      barcode: 'Enter the barcode.',
      name: 'Enter the product name.',
    });
  });

  it('accepts a valid product', () => {
    expect(validateProductForm(COKE)).toEqual({});
  });

  it.each([
    ['04900041834', 'A barcode is 8, 12, 13, or 14 digits.'],
    ['04900041834x', 'A barcode is 8, 12, 13, or 14 digits.'],
    ['049000418348', "That barcode's last digit is wrong. Check it for typos."],
  ])('rejects the barcode %p', (barcode, message) => {
    expect(validateProductForm({ ...COKE, barcode }).barcode).toBe(message);
  });

  it.each(['0', '-1', '1.999', 'abc', '1,95'])('rejects the price %p', (price) => {
    expect(validateProductForm({ ...COKE, price }).price).toMatch(/above 0/);
  });

  it('only takes https photo links', () => {
    expect(validateProductForm({ ...COKE, imageUrl: 'http://example.com/a.jpg' }).imageUrl).toMatch(
      /https/,
    );
    expect(validateProductForm({ ...COKE, imageUrl: 'https://example.com/a.jpg' })).toEqual({});
  });
});

describe('createBody', () => {
  it('sends the fields filled in, trimmed', () => {
    expect(createBody({ ...COKE, name: '  Coke ' })).toEqual({
      barcode: '049000418347',
      name: 'Coke',
      size: '16.9 fl oz',
      price: '1.95',
    });
  });
});

describe('editBody', () => {
  it('sends only what changed', () => {
    expect(editBody(COKE, { ...COKE, name: 'Coke Classic', price: '1.99' })).toEqual({
      name: 'Coke Classic',
      price: '1.99',
    });
  });

  it('sends nothing when nothing changed, including the same price written differently', () => {
    expect(editBody(COKE, { ...COKE, price: '1.950' })).toEqual({});
  });

  it('clears an emptied optional field, but leaves an emptied price alone', () => {
    expect(editBody(COKE, { ...COKE, size: ' ', price: '' })).toEqual({ size: null });
  });
});

describe('stock', () => {
  const row = (storeId: number, change: Partial<StockFormRow> = {}): StockFormRow => ({
    storeId,
    storeName: `Store ${storeId}`,
    choice: 'auto',
    quantity: '',
    current: '',
    ...change,
  });

  it('sends only stores that changed', () => {
    const original = [row(1), row(2, { choice: 'out' }), row(3, { choice: 'in', quantity: '4' })];
    const edited = [
      row(1, { choice: 'in', quantity: '5' }), // set by the admin
      row(2), // handed back to automatic updates
      row(3, { choice: 'in', quantity: '4' }), // unchanged
    ];

    expect(stockChanges(original, edited)).toEqual([
      { storeId: 1, action: 'set', body: { in_stock: true, quantity: 5 } },
      { storeId: 2, action: 'clear' },
    ]);
  });

  it('sends out of stock without a quantity, and in stock with none if left empty', () => {
    const edited = [row(1, { choice: 'out', quantity: '3' }), row(2, { choice: 'in' })];

    expect(stockChanges([row(1), row(2)], edited)).toEqual([
      { storeId: 1, action: 'set', body: { in_stock: false } },
      { storeId: 2, action: 'set', body: { in_stock: true } },
    ]);
  });

  it('needs a whole number above 0 for a quantity, if one is given', () => {
    const rows = [row(1, { choice: 'in', quantity: '0' }), row(2, { choice: 'in', quantity: '2' })];

    expect(Object.keys(validateStock(rows))).toEqual(['1']);
  });
});
