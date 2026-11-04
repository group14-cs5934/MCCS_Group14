import Badge from '@/components/Badge';
import { useApiGet } from '@/hooks/useApiGet';
import type { RestockSummary } from '@/types/restock';

/**
 * How many products are out of stock or low at the store, as a badge. Shows nothing while it
 * loads, if it fails, or when nothing needs restocking. Only render it for people with
 * view_restock, since it asks the API.
 */
export default function RestockBadge({ storeId }: { storeId: number }) {
  const { data } = useApiGet<RestockSummary>(`/staff/stores/${storeId}/restock/summary`);
  const count = data ? data.out + data.low : 0;
  return count > 0 ? <Badge label={String(count)} tone="danger" /> : null;
}
