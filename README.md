# MCCS AR Product Intelligence (Group 14)

Mobile app for scanning retail products and viewing product info, prices, ratings, and reviews.

| Folder     | What                                |
| ---------- | ----------------------------------- |
| `mobile/`  | React Native app (Expo, TypeScript) |
| `backend/` | FastAPI service (Python 3.13, uv)   |

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
      search.tsx
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
- Signed-in requests send the user's Supabase token (`Authorization: Bearer ...`) automatically.
  A `401` comes back as "Your session has expired. Please sign in again."
- Response types live in `src/types/` and mirror the backend's `...Read` models.
- Add one function per endpoint next to the client, like `checkHealth()` in `src/api/health.ts`.

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

- In code, read the user with `const { user, signOut } = useAuth();` from `@/auth`.
- If **Confirm email** is on in Supabase (Authentication → Sign In / Providers → Email), sign-up
  shows "Check your email"; the user opens the link, then signs in. With it off, sign-up signs the
  user straight in.
- Tests never reach Supabase: `__mocks__/@supabase/supabase-js.ts` fakes it and starts signed in.
  Tests about auth control it with `mockAuth` (see `__tests__/auth.test.tsx`).
- User roles come later in T039.

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
- Price is its own table so price history is kept (needed for the price-tracker stretch goal);
  per-store stock belongs in a separate store/product table (T047).

`POST /products/validate` checks a product payload without saving it (useful for demos and forms).

### Endpoints

| Endpoint                  | Returns                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `GET /me`                 | The signed-in user (`id`, `email`), or `401` without a valid token.         |
| `GET /products/{id}`      | One `ProductRead` (with category and current price), or `404` if not found. |
| `POST /products/validate` | The cleaned-up payload, or `422` listing every problem.                     |

A missing product returns `404 {"detail": "Product not found"}`. Only digits match `{id}`, so
`/products/abc` is also a `404`, and named routes like `/products/search` can be added without
clashing. Full request/response details are in the interactive docs at `/docs`.

### Authentication

The app signs users in with Supabase directly and sends their access token as
`Authorization: Bearer <token>`. The API checks the token's signature (with the public keys
Supabase publishes for the project at `SUPABASE_URL`), audience, issuer, and expiry. To require a
signed-in user, take a `CurrentUser` parameter:

```python
from app.core.auth import CurrentUser

@router.get("/me")
def read_me(user: CurrentUser) -> UserRead:  # user.id is the Supabase user's UUID
    ...
```

A missing, expired, or invalid token gets `401 {"detail": "Not authenticated"}`; if Supabase's keys
can't be fetched, `503`. Product endpoints are still public. Tests swap in their own signing key
(see `tests/test_auth.py`), so they never call Supabase. User roles come later in T039.

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

For endpoint tests that should run without Postgres, swap the repository for an in-memory fake
with `app.dependency_overrides[get_product_repository] = lambda: fake` (see
`tests/test_product_lookup_unit.py`). Keep a few database tests too, so the real SQL is covered.

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
   completed successfully." (It adds one product, Sample Chips, with no price.)
4. **Start the API**, from `backend/`: `uv run fastapi dev app/main.py --host 0.0.0.0`. Check
   <http://localhost:8000/products/1> returns Sample Chips as JSON.
5. **Start the app**, from `mobile/`: set the Supabase variables in `mobile/.env` (see
   [Accounts](#accounts-supabase-auth)), run `npm start`, then open it on a phone with Expo Go
   (same Wi-Fi as the computer), a simulator, or press `w` for the browser.
6. **Check the result.** Sign in (or create an account). On Home, tap **Open a sample product** (development builds only). The
   product page shows Snacks, **Sample Chips**, 184g, and "No price yet".
7. **Check the error path.** Stop the API (Ctrl+C) and open the product again: you should see
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
