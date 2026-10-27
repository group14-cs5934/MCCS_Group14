import type { Store } from '@/types/store';

/**
 * Google Maps directions to a store, from wherever the shopper is (T080). Opens the Maps app on
 * phones that have it, and the website otherwise (including on the web). The name helps Maps find
 * a base building from an address like "Bldg. 1231".
 */
export function directionsUrl(store: Pick<Store, 'name' | 'address'>): string {
  const destination = [store.name, store.address].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
