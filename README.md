# MCCS AR Product Intelligence (Group 14)

Mobile app for scanning retail products and viewing product info, prices, ratings, and reviews.

| Folder     | What                                |
| ---------- | ----------------------------------- |
| `mobile/`  | React Native app (Expo, TypeScript) |
| `backend/` | FastAPI service (coming in T004)    |

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
