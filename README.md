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
      _layout.tsx     #   root stack: loads fonts; screens pushed on top of the tabs
      (tabs)/         #   bottom tabs: index (Home), scan, saved
      product/[id].tsx  # product details, e.g. /product/123
      search.tsx
    theme/            # design tokens: colors, typography (Inter), spacing, radius, shadows,
                      #   and sharedStyles. The only place hex colors and font names live.
    components/       # reusable UI (buttons, cards, loaders, error banners)
    api/              # API client for the FastAPI backend
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

| Component      | Use it for                                                                           |
| -------------- | ------------------------------------------------------------------------------------ |
| `Button`       | Actions. `variant`: `primary` (default), `secondary`, `text`; optional `icon`.       |
| `Card`         | White rounded container. `onPress` makes the whole card tappable.                    |
| `Loader`       | Spinner with an optional `message`.                                                  |
| `ErrorBanner`  | Small inline error with optional retry, e.g. inside a card or above a list.          |
| `ErrorState`   | Full-screen error: icon, title, message, Try Again. Extra buttons go in `children`.  |
| `AsyncContent` | Wraps a screen's content and shows a spinner or `ErrorState` in its place as needed. |
| `IconBadge`    | Icon in a soft circle, for call-to-action, empty, and error states.                  |

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
import { api } from '@/api';
import type { Product } from '@/types/product';

const result = await api.get<Product>(`/products/${id}`, { signal });
if (result.ok) {
  setProduct(result.data);
} else if (result.error.kind !== 'aborted') {
  setError(result.error.message);
}
```

- `error.kind`: `network` (unreachable), `timeout`, `http` (4xx/5xx, see `error.status` and
  `error.code`), `invalid-response` (not JSON), or `aborted` (you cancelled via `signal`).
- `error.requestId` matches the backend log line; include it in bug reports.
- Response types live in `src/types/` and mirror the backend's `...Read` models.
- Add one function per endpoint next to the client, like `checkHealth()` in `src/api/health.ts`.

**Which backend the app calls:** in development, port 8000 on the computer running Expo, so it
works on simulators, emulators, and phones on the same Wi-Fi. For a phone or emulator, start the
backend with `--host 0.0.0.0` so it accepts connections from your network:
`uv run fastapi dev app/main.py --host 0.0.0.0`. To use a different API (e.g. a deployed one, or
when running Expo with `--tunnel`), copy `mobile/.env.example` to `mobile/.env` and set
`EXPO_PUBLIC_API_URL`, then restart `npm start`.

### Lint, format & test

```sh
npm test              # Jest tests (e.g. __tests__/navigation.test.tsx)
npm run lint          # ESLint (expo config + Prettier); fails on any error or warning
npm run lint:fix      # auto-fix what can be fixed
npm run format        # Prettier write
npm run format:check  # Prettier check only
npm run typecheck     # tsc --noEmit
```

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

| Variable       | Required | Default       | Notes                                                         |
| -------------- | -------- | ------------- | ------------------------------------------------------------- |
| `DATABASE_URL` | yes      |               | Postgres connection string                                    |
| `APP_ENV`      | no       | `development` | `development`, `test`, or `production`                        |
| `LOG_LEVEL`    | no       | `INFO`        | `DEBUG`, `INFO`, `WARNING`, or `ERROR`                        |
| `CORS_ORIGINS` | no       | _(none)_      | Comma-separated browser origins, e.g. `http://localhost:8081` |

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

### Test & lint

```sh
uv run pytest            # tests
uv run ruff check .      # lint
uv run ruff format .     # format (use --check to only check)
```

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request
and every push to `main`. A failing step shows as a failed check on the PR.

| Job       | Checks                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `Backend` | `ruff check`, `ruff format --check`, `pytest`                           |
| `Mobile`  | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` |

Every check runs even when an earlier one fails, so a single run lists all problems. Click
**Details** on a failed check to see the log. To run the same checks locally before pushing:

```sh
# in backend/
uv run ruff check . && uv run ruff format --check . && uv run pytest

# in mobile/
npm run lint && npm run format:check && npm run typecheck && npm test
```
