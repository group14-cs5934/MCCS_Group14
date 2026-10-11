import type { Price } from '@/types/product';

/** "$3.49" for US dollars, otherwise e.g. "3.49 EUR". The API already sends exactly 2 decimals. */
export function formatPrice({ amount, currency }: Pick<Price, 'amount' | 'currency'>): string {
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}
