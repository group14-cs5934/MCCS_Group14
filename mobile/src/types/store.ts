// Shapes of the stores API (backend/app/schemas/store.py); update both together.

/** An MCCS store, from GET /locations. */
export type Store = {
  id: number;
  name: string;
  slug: string;
  address: string | null;
};
