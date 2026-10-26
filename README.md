# MCCS AR Product Intelligence (Group 14)

Mobile app for scanning retail products and viewing product info, prices, ratings, and reviews.

| Folder                  | What                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `mobile/`               | React Native app (Expo, TypeScript)                                |
| `backend/`              | FastAPI service (Python 3.13, uv)                                  |
| `jobs/product-monitor/` | [Job](#product-monitor-job) reading MCCS online store prices/stock |

## Mobile app

Requires Node 20+ and npm.

```sh
cd mobile
npm install
npm start          # starts Expo dev server; press i (iOS sim) or a (Android emulator),
                   # or scan the QR code with the Expo Go app on your phone
```

iOS simulator needs macOS + Xcode. Android emulator needs Android Studio. On Windows without
either, use Expo Go on a physical phone, or press `w` for a quick browser preview (native-only
features like the camera won't work on web).

### Folder structure

```
mobile/
  src/
    app/              # screens (Expo Router): every file here is a route
      _layout.tsx     #   root stack: loads fonts and the session; signed-out users only see
                      #   sign-in/sign-up, signed-in users see the tabs and screens on top of them
      (tabs)/         #   bottom tabs: index (Home), scan, saved
      product/[id].tsx  # product details, e.g. /product/123
      product/barcode/[code].tsx  # same page, opened by barcode after a scan
      search.tsx      # product search; searches once typing pauses (useProductSearch)
      admin.tsx       # admin area (admins only): Products, Users, and Activity (the audit log);
                      #   admins start here after signing in (Back goes to Home); others see
                      #   "Admins only"
      sign-in.tsx, sign-up.tsx  # email + password accounts (Supabase Auth)
    theme/            # design tokens: colors, typography (Inter), spacing, radius, shadows,
                      #   and sharedStyles. The only place hex colors and font names live.
    components/       # reusable UI (buttons, cards, loaders, error banners)
    api/              # API client for the FastAPI backend
    auth/             # Supabase client, AuthProvider/useAuth, form validation
    hooks/            # shared React hooks
    types/            # shared TypeScript types (Product, Price, ...)
    utils/            # small helpers (formatting, validation)
    dev/              # developer-only screens (ThemePreview)
  __tests__/          # Jest tests (never put tests in src/app, every file there is a route)
```

Import from `src/` with the `@/` alias: `import { colors } from '@/theme';`

### Navigation

Built with [Expo Router](https://docs.expo.dev/router/introduction/). To add a screen, add a file
under `src/app/`:

- A new **tab**: add a file in `src/app/(tabs)/` and a `<Tabs.Screen>` in `(tabs)/_layout.tsx`.
- A screen **pushed on top of the tabs** (back returns to the tab): add it directly in
  `src/app/` and a `<Stack.Screen>` in `src/app/_layout.tsx` for its title.
- Navigate with `<Link href="/product/123">` or `router.push('/product/123')`.

### Theme rules

- Never hard-code colors, font names, or sizes in a component. Use `colors`, `textStyles`,
  `spacing`, and `radius` from `@/theme`, or a ready-made style from `sharedStyles`.
- To change the look of the app, edit the token in `src/theme/` and every screen updates.
- Custom fonts: set `fontFamily` (e.g. `fonts.bold`), not `fontWeight`. Android ignores
  `fontWeight` on custom fonts.

### Shared components

Reusable UI lives in `src/components/`; use these instead of building your own. All of them
appear on the dev **Theme preview** screen (link on Home in development builds).

| Component              | Use it for                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `Button`               | Actions. `variant`: `primary` (default), `secondary`, `text`; optional `icon`.       |
| `Card`                 | White rounded container. `onPress` makes the whole card tappable.                    |
| `Loader`               | Spinner with an optional `message`.                                                  |
| `ErrorBanner`          | Small inline error with optional retry, e.g. inside a card or above a list.          |
| `ErrorState`           | Full-screen error: icon, title, message, Try Again. Extra buttons go in `children`.  |
| `AsyncContent`         | Wraps a screen's content and shows a spinner or `ErrorState` in its place as needed. |
| `IconBadge`            | Icon in a soft circle, for call-to-action, empty, and error states.                  |
| `TextField`            | Labeled text input with an optional `error` shown below it (forms, sign-in).         |
| `CameraPermissionGate` | Wraps anything that needs the camera; asks for access and handles "denied" for you.  |
| `BarcodeScanner`       | Live camera for UPC/EAN barcodes; `onScanned` gets one once it stays in view 0.5s.   |
| `ProductPage`          | Body of the product page; shared by the by-ID and by-barcode product routes.         |
| `ReviewForm`           | Write or edit the signed-in user's review of a product; checks length before posting. |
| `ReviewList`           | A product's reviews from `useReviews`; loads the next page via `loadMore`.           |
| `SearchResultsList`    | List of product cards (photo, name, size, price); `onOpen` gets the tapped product.  |
| `StarRating`           | Five stars. With `onChange`, tap to rate 1–5; without, shows e.g. an average (½s).   |

**Loading and error props.** `Card` and `AsyncContent` take `loading`, `error` (a message string),
and `onRetry`. While `loading` is true they show a spinner instead of their content; when `error`
is set they show the error instead, with a Try Again button if `onRetry` is given. `loading` wins
over `error`, so a retry in progress shows the spinner. `Button` also takes `loading`: it shows a
spinner and ignores taps.

```tsx
<View style={sharedStyles.screen}>
  <AsyncContent loading={isLoading} error={error} onRetry={reload}>
    <ProductDetails product={product} />
  </AsyncContent>
</View>
```

### Calling the API

Use the client in `src/api/` for every backend call; don't call `fetch` directly. It never throws:
each call resolves to `{ ok: true, data }` or `{ ok: false, error }`, where `error.message` is a
friendly sentence you can show as-is (e.g. as `AsyncContent`'s `error`). If the API is unreachable
you get a "Can't reach the server" error instead of a crash; requests time out after 10 seconds.

```tsx
import { api } from "@/api";
import type { Product } from "@/types/product";

const result = await api.get<Product>(`/products/${id}`, { signal });
if (result.ok) {
  setProduct(result.data);
} else if (result.error.kind !== "aborted") {
  setError(result.error.message);
}
```

- `error.kind`: `network` (unreachable), `timeout`, `http` (4xx/5xx, see `error.status` and
  `error.code`), `invalid-response` (not JSON), or `aborted` (you cancelled via `signal`).
- `error.requestId` matches the backend log line; include it in bug reports.
- `error.actions` lists what to offer the shopper next, when the server says. An unknown scanned
  barcode gives `['retry_scan', 'manual_search']`, which `ProductPage` shows as "Product not
  found" with Retry (back to the scanner) and Search (opens the search screen).
- Signed-in requests send the user's Supabase token (`Authorization: Bearer ...`) automatically.
  A `401` comes back as "Your session has expired. Please sign in again."
- Response types live in `src/types/` and mirror the backend's `...Read` models.
- Add one function per endpoint next to the client, like `checkHealth()` in `src/api/health.ts`.
- To load something when a screen opens, use `useApiGet<T>(path)` (`src/hooks/useApiGet.ts`): it gives
  `{ loading, data, error, reload }` and cancels the request if the screen closes first.

**Which backend the app calls:** in development, port 8000 on the computer running Expo, so it
works on simulators, emulators, and phones on the same Wi-Fi. For a phone or emulator, start the
backend with `--host 0.0.0.0` so it accepts connections from your network:
`uv run fastapi dev app/main.py --host 0.0.0.0`. To use a different API (e.g. a deployed one, or
when running Expo with `--tunnel`), copy `mobile/.env.example` to `mobile/.env` and set
`EXPO_PUBLIC_API_URL`, then restart `npm start`.

### Accounts (Supabase Auth)

The app requires an account: it opens on **Sign in** until the user signs in or creates an
account, and remembers the session on the device. Accounts live in the team's Supabase project.
Before running the app, copy `mobile/.env.example` to `mobile/.env` and set:

| Variable                   | Where to find it                                                 |
| -------------------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL                  |
| `EXPO_PUBLIC_SUPABASE_KEY` | Same page: the **publishable** (anon) key. Never the secret key. |

- In code, read the user with `const { user, role, isAdmin, signOut } = useAuth();` from `@/auth`.
  `role` (`'user'` or `'admin'`) comes from the API's `GET /me` after sign-in, so it's `null`
  while that loads or if the API is unreachable. Treat `null` as a regular user. Admins see
  "· Admin" next to their email on Home.
- If **Confirm email** is on in Supabase (Authentication → Sign In / Providers → Email), sign-up
  shows "Check your email"; the user opens the link, then signs in. With it off, sign-up signs the
  user straight in.
- Tests never reach Supabase: `__mocks__/@supabase/supabase-js.ts` fakes it and starts signed in.
  Tests about auth control it with `mockAuth` (see `__tests__/auth.test.tsx`). `jest.setup.ts`
  stubs `getMe` so every signed-in test user is a `'user'` unless the test says otherwise.

### Lint, format & test

```sh
npm test              # Jest tests (e.g. __tests__/navigation.test.tsx)
npm run lint          # ESLint (expo config + Prettier); fails on any error or warning
npm run lint:fix      # auto-fix what can be fixed
npm run format        # Prettier write
npm run format:check  # Prettier check only
npm run typecheck     # tsc --noEmit
```

Tests never touch the real camera: `__mocks__/expo-camera.ts` stands in for it automatically.

Run `npm run lint && npm run typecheck && npm test` before opening a PR. Install the recommended VS Code
extensions (ESLint, Prettier) to get format-on-save.

## Backend

Requires [uv](https://docs.astral.sh/uv/getting-started/installation/) (it installs Python 3.13
for you).

```sh
cd backend
uv sync                          # create .venv and install dependencies
cp .env.example .env             # then fill in real values (never commit .env)
uv run fastapi dev app/main.py   # http://localhost:8000, API docs at /docs
```

### Configuration

Settings are read from environment variables and `backend/.env` (real environment variables
win). They're defined and validated in `app/core/config.py`; `.env.example` lists every variable.

| Variable              | Required | Default       | Notes                                                         |
| --------------------- | -------- | ------------- | ------------------------------------------------------------- |
| `DATABASE_URL`        | yes      |               | Postgres connection string                                    |
| `SUPABASE_URL`        | yes      |               | Supabase Project URL, used to verify sign-in tokens           |
| `SUPABASE_JWT_SECRET` | no       |               | Only for projects on Supabase's legacy JWT secret             |
| `APP_ENV`             | no       | `development` | `development`, `test`, or `production`                        |
| `LOG_LEVEL`           | no       | `INFO`        | `DEBUG`, `INFO`, `WARNING`, or `ERROR`                        |
| `CORS_ORIGINS`        | no       | _(none)_      | Comma-separated browser origins, e.g. `http://localhost:8081` |

If a required variable is missing or a value is invalid, the server refuses to start and prints
which variable is wrong. To add a variable: add a field to `Settings`, add it to `.env.example`,
and add a row here. Read settings in code with `get_settings()` (or `Depends(get_settings)` in a
route).

### Health, CORS & logging

- `GET /health` returns `200 {"status": "ok"}` while the service is up.
- **CORS**: only origins in `CORS_ORIGINS` may call the API from a browser; others are blocked
  (preflight gets `400`). The native app isn't a browser and doesn't need an entry. Origins must
  be `scheme://host[:port]` with no trailing slash, or the server won't start.
- **Request logging**: every request logs one line, e.g.
  `GET /products/123 -> 200 (4.2 ms) [request_id=9f1c...]`. The query string is never logged.
  Each response carries an `X-Request-ID` header (the app can send its own); include it in bug
  reports to find the matching log line. Successful `/health` calls log at `DEBUG` only.

### API models

Request/response models live in `app/schemas/`. Each resource has a `...Create` model (what
clients send; unknown fields are rejected) and a `...Read` model (what the API returns). Invalid
payloads get `422` with every problem listed.

| Model      | Required               | Optional                                                          |
| ---------- | ---------------------- | ----------------------------------------------------------------- |
| `Product`  | `barcode`, `name`      | `brand_id`, `category_id`, `description`, `size`, `image_url`     |
| `Price`    | `product_id`, `amount` | `currency` (default `USD`), `source`, `observed_at` (default now) |
| `Category` | `name`, `slug`         | `description`                                                     |
| `Brand`    | `name`                 |                                                                   |

- `barcode`: 8, 12, 13, or 14 digits (EAN-8, UPC-A, EAN-13, GTIN-14) with a valid check digit.
- `amount`: exact decimal, greater than 0, at most 2 decimal places; sent in JSON as a string
  (`"3.49"`) so it never loses cents.
- `slug`: lowercase words joined by hyphens, e.g. `chips-snacks`.
- IDs are integers. `ProductRead` includes the nested `brand`, `category`, and current `price`.
- Product and category names have `pg_trgm` trigram indexes (migration 003) for typo-tolerant
  search: `'coffe' <% name` matches "Ground Coffee". See the migration for how to query them.
- Price is its own table so price history is kept (needed for the price-tracker stretch goal);
  per-store stock belongs in a separate store/product table (T047).

`POST /products/validate` checks a product payload without saving it (useful for demos and forms).

### Endpoints

| Endpoint                       | Returns                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `GET /me`                      | The signed-in user (`id`, `email`, `role`), or `401` without a valid token. |
| `GET /products/{id}`           | One `ProductRead` (with category and current price), or `404` if not found. |
| `GET /products/barcode/{code}` | The same `ProductRead` for the product with this barcode, or `404`.         |
| `GET /products/search`         | A list of `ProductRead` matching `q` and/or `category`; `[]` if none match. |
| `POST /products/validate`      | The cleaned-up payload, or `422` listing every problem.                     |
| `GET /products/{id}/reviews`   | A page of reviews, newest first (`limit`, `offset`), or `404`.              |
| `POST /products/{id}/reviews`  | Saves the signed-in user's review (one per product); `401` if signed out.   |
| `GET /locations`               | Every MCCS store, sorted by name.                                           |
| `GET /products/{id}/availability` | Each store with `in_stock` for the product (in stock first), or `404`.   |

Search also takes `store=<slug>` (only products that store carries) and `in_stock=true` (only
products in stock there, or at any store without `store`).

A missing product returns `404` with code `product_not_found`. Only digits match `{id}`, so
`/products/abc` is also a `404`, and named routes like `/products/search` can be added without
clashing. The app normalizes scans first (e.g. UPC-E to UPC-A), and leading zeros are ignored
when matching a barcode, so `012000001291` (UPC-A) finds a product stored as `0012000001291`
(EAN-13). Anything else, including a code that isn't 8, 12, 13, or 14 digits, is a `404`. Full request/response details are in the interactive docs at `/docs`.

**Ratings.** Seeing a product's average is public; rating needs a signed-in user (`401` without
a valid token):

| Endpoint                            | Does                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `GET /products/{id}/ratings`        | Average and count, e.g. `{"product_id": 7, "average": 3.0, "count": 2}`.     |
| `POST /products/{id}/ratings`       | Saves your rating, body `{"stars": 4}`. Rating again changes your stars.     |
| `GET /products/{id}/ratings/me`     | Your rating of the product, or `404` with code `rating_not_found` if none.   |
| `DELETE /products/{id}/ratings/me`  | Removes your rating (`204`, no body), or `404` `rating_not_found` if none.   |

`average` is rounded to 2 decimal places and is `null` (with `count` 0) until someone rates the
product. `POST` and `GET .../me` return `{"product_id", "stars", "created_at",
"updated_at"}`. `stars` must be a whole number from 1 to 5; anything else (`0`, `6`, `4.5`,
`"4"`) is a `422`. An unknown product is a `404` with code `product_not_found`.

Search takes `q` (words in the product name; small typos are fine, best match first),
`category` (a category slug; only that category's products, sorted by name), or both, plus
`limit` (1–50, default 20) and `offset` for paging. For example,
`/products/search?q=coffe&category=coffee-tea`. No matches, a blank search, or an unknown
category give `[]`, not an error.

### Errors

Every error response (4xx and 5xx, from any endpoint) has the same JSON body (`ErrorResponse`):

```json
{ "code": "product_not_found", "message": "Product not found" }
```

- `code` is stable and machine-readable; check it in code. `message` is for developers and logs,
  not shoppers (the app shows its own friendly text, see the API client above).
- Validation errors are `422` with code `validation_error` and a `details` list, one entry per
  problem (`loc`, `msg`, `type`).
- Errors the shopper can recover from add `actions`, what the app should offer next. A scanned
  barcode that isn't found (`GET /products/barcode/{code}`) is a `404` with
  `"actions": ["retry_scan", "manual_search"]`, since it may have been misread or the product
  isn't in the catalog yet. Other errors leave `actions` out.

  ```json
  {
    "code": "product_not_found",
    "message": "Product not found",
    "actions": ["retry_scan", "manual_search"]
  }
  ```

- Unknown URLs are `not_found`, wrong methods `method_not_allowed`, and crashes
  `internal_error` (the exception text is never sent).

To return an error from a route, raise `ApiError` (`app/core/errors.py`) with its own code
(and `actions=[ErrorAction...]` if the app should offer something); a plain `HTTPException` also works and gets a code from its status (e.g. `403` → `forbidden`).
Document error statuses with `error_response()` and give each new router
`responses={422: error_response(...)}` so `/docs` shows this format instead of FastAPI's default.

```python
raise ApiError(404, "product_not_found", "Product not found")
```

### Authentication

The app signs users in with Supabase directly and sends their access token as
`Authorization: Bearer <token>`. The API checks the token's signature (with the public keys
Supabase publishes for the project at `SUPABASE_URL`), audience, issuer, and expiry. To require a
signed-in user, take a `CurrentUser` parameter; for admins only, take `AdminUser`:

```python
from app.core.auth import AdminUser, CurrentUser

@router.get("/me")
def read_me(user: CurrentUser) -> UserRead:  # user.id is the Supabase user's UUID, user.role
    ...

@router.delete("/products/{product_id}")
def delete_product(product_id: int, user: AdminUser) -> None:  # 403 for regular users
    ...
```

A missing, expired, or invalid token gets `401` with code `not_authenticated`; a signed-in user
without the right role gets `403` with code `forbidden`; if Supabase's keys can't be fetched,
`503` with code `auth_unavailable`. Product endpoints are still public. Tests swap in their own signing key
(see `tests/test_auth.py`), so they never call Supabase.

**Users and roles.** Accounts live in Supabase Auth; the `users` table
(`migrations/004_create_users.sql`) stores each user's role. A user's row is added with the
`user` role the first time they call the API. The app calls `GET /me` right after signing in, so
this happens at sign-up, or at the first sign-in when email confirmation is on. There are two
roles, `user` and `admin`. `require_role(...)` in `app/core/auth.py` builds a check for other
combinations. To make the first admin (after they've signed in once), run in the Supabase SQL
editor, or locally with `docker exec -it mccs-db psql -U postgres -d mccs`:

```sql
UPDATE users SET role = 'admin' WHERE email = 'someone@example.com';
```

After that, admins manage users through the API (below). The API reads each user's role on
every request, so a change applies to their next request; the app shows the new role the next
time the user signs in. Row level security is on for
`users` with no policies, so the app's publishable key can't read it or change roles through
Supabase's REST API; only the backend can.

**Managing users (admins only).** `401` without a valid token, `403 forbidden` for non-admins:

| Endpoint                  | Does                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `GET /admin/users`        | Users in join order (`id`, `email`, `role`, `active`, `created_at`). Takes `email` (contains, any case), `limit` (1–100, default 50), `offset`. |
| `PATCH /admin/users/{id}` | Changes `role` and/or `active`, e.g. `{"role": "admin"}` or `{"active": false}`; returns the user. `404 user_not_found` if there's no such user. |

Changes apply to the user's next request. A deactivated user (`deactivated_at` set, migration
006) gets `403` with code `account_deactivated` from every signed-in endpoint until an admin sets
`{"active": true}`; their Supabase sign-in itself still works. Admins can't remove their own
admin role or deactivate themselves (`409 cannot_change_own_account`), so there's always an admin
left.

**Managing products (admins only)**, same `401`/`403` rules. Each returns the product as
`GET /products/{id}` does, and the app shows the change on its next request:

| Endpoint                         | Does                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `GET /admin/products`            | Every product sorted by name (`q` searches names), with `limit` (1–100, default 50) and `offset`. |
| `POST /admin/products`           | Adds a product (`201`): `barcode` and `name` required; `description`, `size`, `image_url`, `category_id`, and `price` (e.g. `"3.49"`) optional. |
| `PATCH /admin/products/{id}`     | Changes only the fields sent; `null` clears an optional field. A new `price` becomes the current one (older prices are kept as history). |
| `DELETE /admin/products/{id}`    | Removes the product with its prices, ratings, and reviews (`204`).         |

A barcode another product already has is `409 barcode_taken`, including the same barcode with
different leading zeros (`012000001291` and `0012000001291`). A `category_id` that isn't a
category is `422 category_not_found`; an unknown product is `404 product_not_found`. Prices
entered here are recorded with source `admin`.

**Moderating reviews (admins only)**, same `401`/`403` rules:

| Endpoint                      | Does                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `GET /admin/reviews`          | Every review, newest first, including hidden ones, with `author_email`, `user_id`, `hidden`, and `hidden_at`. Filters: `product_id`, `hidden` (`true`/`false`); paging with `limit` (1–100, default 50) and `offset`. |
| `PATCH /admin/reviews/{id}`   | `{"hidden": true}` hides a review, `{"hidden": false}` shows it again; returns the review. |
| `DELETE /admin/reviews/{id}`  | Removes a review for good (`204`).                                            |

A hidden review (`hidden_at` set, migration 009) is left out of `GET /products/{id}/reviews` and
its `total`, so it disappears from the app; it's kept so it can be shown again. Its author still
sees it through `.../reviews/me` and can edit or remove it, but editing doesn't unhide it. Hiding a
review doesn't change the author's rating. An unknown review is `404 review_not_found`.

New admin endpoints go under `/admin` and take an `AdminUser` parameter.
`tests/test_admin_access.py` finds every `/admin` route by itself and checks that regular
users get `403`, missing or bad tokens `401`, and deactivated admins `403`, so a route that
forgets the check fails CI.

**Ratings and reviews.** `migrations/005_create_ratings_and_reviews.sql` adds two tables, each
linked to a product and a user and deleted along with either (row level security on, like
`users`):

| Table     | Columns                                              | Rules                                          |
| --------- | ---------------------------------------------------- | ---------------------------------------------- |
| `ratings` | `product_id`, `user_id`, `stars`                     | 1–5 stars; one per user per product            |
| `reviews` | `product_id`, `user_id`, `title` (optional), `body` | body ≤ 2000 chars, title ≤ 100, neither blank; one per user per product |

Both have `created_at` and `updated_at`. Because of the one-per-user rule, save a rating with
`INSERT ... ON CONFLICT (product_id, user_id) DO UPDATE`, so rating again changes the stars.
`reviews` has an index for listing a product's reviews newest first (`ORDER BY created_at DESC,
id DESC`). A user's row must exist before they rate or review, which `GET /me` (or any
signed-in request) takes care of.

### Database access

The app opens a connection pool at startup (`app/core/database.py`). Routes never connect or
write SQL themselves: they ask for a repository from `app/repositories/` (or, for one-off queries,
a `DbConnection`) as a parameter.

```python
from app.repositories import Products

@router.get("/{product_id}")
def get_product(product_id: int, products: Products) -> ProductRead:
    product = products.get_by_id(product_id)  # or products.get_by_barcode(code)
    ...
```

- Each request gets its own connection from the pool, so concurrent requests never share one.
- A request's queries run in one transaction: committed when the route returns, rolled back if it
  raises.
- The API starts even if the database is down (`/health` still works); requests that need the
  database fail after 5 seconds until it's reachable.
- Add queries as methods on a repository (one per resource, e.g. `ProductRepository`) and
  always pass values as `%s` parameters, never by building SQL strings.

### Test & lint

```sh
uv run pytest            # tests
uv run ruff check .      # lint
uv run ruff format .     # format (use --check to only check)
```

Database tests (repositories, sessions) need Postgres and are skipped unless `TEST_DATABASE_URL`
is set; CI always runs them. Each test runs in its own temporary schema with the migrations
applied, so any Postgres works, e.g. a throwaway Docker container:

```sh
docker run -d --name mccs-test-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres uv run pytest
```

`tests/test_search_contract.py` checks that `mobile/__tests__/fixtures/search-api-response.json`
is exactly what `GET /products/search` returns; the app's tests use that file as the API's
response. If you change the search response on purpose, regenerate it with
`UPDATE_SEARCH_FIXTURE=1` (plus `TEST_DATABASE_URL`) and run the mobile tests.

For endpoint tests that should run without Postgres, swap the repository for an in-memory fake
with `app.dependency_overrides[get_product_repository] = lambda: fake`, using `FakeProducts`
from `tests/fakes.py` (see `tests/test_product_search_unit.py`). Keep a few database tests too,
so the real SQL is covered.

## Product data sync

`scripts/sync_products.py` pulls real products into the catalog: it fetches them from the data
source (UPCitemdb, the source the T022 spike used), cleans them up (prices, sizes, photos,
categories), and saves them to `DATABASE_URL`, updating products that are already stored instead
of adding duplicates. From `backend/`:

```sh
uv run python -m scripts.sync_products --file scripts/sample_products.json   # offline, saved data
uv run python -m scripts.sync_products --dry-run      # look up scripts/catalog_barcodes.txt, save nothing
uv run python -m scripts.sync_products --include-stored --limit 90           # what runs nightly
```

**Nightly sync.** [`.github/workflows/nightly-sync.yml`](.github/workflows/nightly-sync.yml) runs
the last command every night at 07:00 UTC (and on demand from the Actions tab). It needs the
repository secret `SYNC_DATABASE_URL` (the Supabase connection string); without it, the job skips
the sync. UPCitemdb's free trial allows 100 lookups a day, hence `--limit 90`.

## Product monitor job

`jobs/product-monitor/` is a script, run on a schedule, that keeps prices and stock up to date
from the MCCS online store. It has its own uv project, so run its commands from that folder.

For each entry in `products.yaml` it fetches the product page (it obeys robots.txt and waits
`PER_DOMAIN_DELAY` seconds between requests to one site), and Claude reads the barcode, price
and stock from the page. Then, in one transaction, it:

- adds the product to `products` if its barcode is new (name, size and photo from the page). An
  existing product is never changed, so edits made in the admin screen stay;
- adds a row to `prices` with `source` set to the store's slug. The app shows the newest price,
  so this becomes the product's current price;
- updates the product's `product_stock` row for that store (`aisle` is left alone).

Barcodes must pass the same length and check digit rules as the API, and are stored as the
digits printed on the package (a UPC-A is stored as 12 digits). A page that's for a different
product, or that shows no price and no stock, is skipped and nothing is written for it.

```sh
cd jobs/product-monitor
uv sync
uv run make_products_yaml.py               # build products.yaml from backend/scripts/demo_products.csv
uv run product-monitor.py --dry-run        # print the rows it would write; doesn't touch the database
uv run product-monitor.py --only doritos   # only entries whose name or barcode contains "doritos"
uv run product-monitor.py                  # write to the database
```

**`products.yaml`**: one entry per product and store. Entries without a `url` are skipped, and
`store` must be a `store_locations.slug` (the seed adds `mcx-online`, the MCX Online Store).
`barcode` is optional. It's read off the page, so set it only if the page doesn't show one, or to
make sure the page is for that product. Quote it, so YAML keeps leading zeros.

```yaml
products:
  - name: "Doritos Nacho Cheese Tortilla Chips (9.25 oz bag)"
    store: "mcx-online"
    url: "https://<MCCS online store product page>"
    barcode: null  # optional
```

`make_products_yaml.py` makes one entry for each product in `demo_products.csv`, with `url` left
to fill in. Running it again keeps the URLs and barcodes already filled in, and any entries added
by hand.

The job reads its settings from environment variables only (not from `backend/.env`):

| Variable            | Required        | Default                   | Notes                                                        |
| ------------------- | --------------- | ------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`      | yes, to write   |                           | Same Postgres connection string as the backend               |
| `ANTHROPIC_API_KEY` | yes             |                           | Claude API key                                               |
| `PRODUCTS_FILE`     | no              | `products.yaml`           | Relative to the folder the job runs from                     |
| `USER_AGENT`        | no              | `ProductMonitorBot/1.0 …` | Set a real contact address before running it on a schedule   |
| `CLAUDE_MODEL`      | no              | `claude-haiku-5-5`        | Model that reads the pages                                   |
| `DEFAULT_CURRENCY`  | no              | `USD`                     | Used when a page shows a price but no currency               |
| `CONCURRENCY`       | no              | `4`                       | Products processed at once                                   |
| `PER_DOMAIN_DELAY`  | no              | `3`                       | Seconds between requests to the same site                    |
| `MAX_PAGE_CHARS`    | no              | `40000`                   | Page text sent to Claude per product                         |

The job exits with an error only if every product fails. CI doesn't check this folder yet, so
run `uv run ruff check . && uv run ruff format --check .` in it before pushing.

## Running the full stack (app ↔ API ↔ database)

Use this to check the whole chain end to end (the T025 integration test). Commands are for Git
Bash or macOS/Linux; run them from the repo root unless a step says otherwise.

1. **Start a fresh database and apply the migrations** (needs Docker Desktop running):

   ```sh
   docker run -d --name mccs-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mccs -p 5432:5432 postgres:17
   for f in backend/migrations/*.sql; do docker exec -i mccs-db psql -U postgres -d mccs -v ON_ERROR_STOP=1 < "$f"; done
   ```

   To use the team's Supabase database instead, put its connection string in `backend/.env` and
   skip this step if its tables already exist (otherwise run each migration file, in order, in
   Supabase's SQL editor). The seeded product may then not have ID 1.

2. **Configure the backend.** In `backend/.env` (copy `backend/.env.example`):
   `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mccs`, the team's
   `SUPABASE_URL`, and `CORS_ORIGINS=http://localhost:8081`.
3. **Seed it**, from `backend/`: `uv run python -m scripts.seed_dev` → prints "Development seed
   completed successfully." It adds Sample Chips (product 1, no price), then the real products in
   `backend/scripts/sample_products.json` (e.g. Diet Pepsi 20 oz, `012000171741`, $1.59) with
   their photos and prices, so you can scan them, and the store locations (two MCX stores and
   the MCX Online Store used by the [product monitor](#product-monitor-job)). Running it again
   skips products and stores already there.
4. **Start the API**, from `backend/`: `uv run fastapi dev app/main.py --host 0.0.0.0`. Check
   <http://localhost:8000/products/1> returns Sample Chips as JSON.
5. **Start the app**, from `mobile/`: set the Supabase variables in `mobile/.env` (see
   [Accounts](#accounts-supabase-auth)), run `npm start`, then open it on a phone with Expo Go
   (same Wi-Fi as the computer), a simulator, or press `w` for the browser.
6. **Check the result.** Sign in (or create an account). On Home, tap **Open a sample product** (development builds only). The
   product page shows Snacks, **Sample Chips**, 184g, and "No price yet".
7. **Check search.** Go back, tap **Search manually**, and type `sample chps` (with the typo). Once
   you stop typing, **Sample Chips** appears with 184g and "No price yet", the same result as
   <http://localhost:8000/products/search?q=sample%20chps>. Tap it to open its product page.
8. **Check scanning.** On the **Scan** tab, scan a product from `sample_products.json` (a
   20 oz Pepsi or Diet Pepsi bottle, or 16.9 oz Coca-Cola, is easy to find). Its product page
   opens with the same name and price as `http://localhost:8000/products/barcode/<its barcode>`.
   No product at hand? Scan a picture of its barcode shown on another screen.
9. **Check the error path.** Stop the API (Ctrl+C) and open the product again: you should see
   "Can't reach the server…" with **Try Again**. Start the API, tap Try Again, and the product
   loads.

If it doesn't work:

- **"Can't reach the server" on a phone:** the API wasn't started with `--host 0.0.0.0`, the phone
  is on a different network, or the firewall is blocking port 8000 (on Windows, allow Python on
  private networks when prompted).
- **"We couldn't find what you're looking for":** there's no product with ID 1 in that database;
  seed a fresh one (step 1) or open the product's actual ID.
- **Nothing loads in the browser:** `CORS_ORIGINS` must include `http://localhost:8081`.
- **Port 8000 already in use:** stop the other program, or run the API with `--port 8001` and set
  `EXPO_PUBLIC_API_URL=http://<your computer's IP>:8001` in `mobile/.env`.

### Sprint 2 end-to-end check: scan, search, product page (T048)

`mobile/__tests__/sprint2-e2e.test.tsx` walks these flows through the whole app on every PR, and
fails if the app logs any error or warning. To check them on a phone, run the full stack with
the sample catalog (`uv run python -m scripts.seed_dev`) and go through each one:

| Flow | Steps | Expected |
| ---- | ----- | -------- |
| Scan | Home -> **Scan Product** -> point at a Diet Pepsi 20 oz (012000171741) | Its page: name, $1.59, rating; Back returns to the camera |
| Search | Home -> **Search manually** -> type `pepsi` -> tap a result | Its page; Back returns to the same results |
| Unknown scan | Scan any barcode not in the catalog -> **Search** -> find a product by name | "Product not found" with Retry and Search, then the product's page |
| Mixed | Scan, close the page, search, open a result, then scan again | Every page loads; no error screens |

### Checking reviews and ratings end to end (T073)

`backend/tests/test_reviews_integration.py` runs this automatically against a real database (CI
runs it on every PR). To see it on a device, with the full stack running and two accounts:

1. Sign in as the first account, open a product, tap a star, then open **Reviews**, write a
   review, and tap **Post review**. It appears at the top of the list.
2. Sign out, sign in as the second account, and open the same product's **Reviews** tab: the
   first account's review is there with its stars, shown as e.g. `a***` (never the email).
3. In Supabase's table editor (or `psql`), the `reviews` row's `user_id` is the first account's
   ID in `users`.

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request
and every push to `main`. A failing step shows as a failed check on the PR.

| Job       | Checks                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `Backend` | `ruff check`, `ruff format --check`, `pytest` (with a Postgres service) |
| `Mobile`  | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` |

Every check runs even when an earlier one fails, so a single run lists all problems. Click
**Details** on a failed check to see the log. To run the same checks locally before pushing:

```sh
# in backend/
uv run ruff check . && uv run ruff format --check . && uv run pytest

# in mobile/
npm run lint && npm run format:check && npm run typecheck && npm test
```
