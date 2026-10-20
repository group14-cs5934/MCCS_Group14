import type { ApiError } from '@/api';
import { useApiGet } from '@/hooks/useApiGet';
import type { Product } from '@/types/product';

export type ProductState = {
  /** True until the current request finishes, including while retrying. */
  loading: boolean;
  product: Product | null;
  /** Set when loading failed; `error.message` is safe to show, `error.status` is 404 if missing. */
  error: ApiError | null;
  /** Fetch the product again, e.g. from a Try Again button. */
  reload: () => void;
};

/** Loads one product from GET /products/{id}. */
export function useProduct(id: string): ProductState {
  return useProductAt(`/products/${encodeURIComponent(id)}`);
}

/** Loads the product with this barcode from GET /products/barcode/{code}, e.g. after a scan. */
export function useProductByBarcode(barcode: string): ProductState {
  return useProductAt(`/products/barcode/${encodeURIComponent(barcode)}`);
}

function useProductAt(path: string): ProductState {
  const { loading, data, error, reload } = useApiGet<Product>(path);
  return { loading, product: data, error, reload };
}
