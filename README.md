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
  index.ts            # entry point, registers src/App
  src/
    App.tsx           # root component: loads fonts, then renders the app
    theme/            # design tokens: colors, typography (Inter), spacing, radius, shadows,
                      #   and sharedStyles. The only place hex colors and font names live.
    components/       # reusable UI (buttons, cards, loaders, error banners)
    api/              # API client for the FastAPI backend
    hooks/            # shared React hooks
    types/            # shared TypeScript types (Product, Price, ...)
    utils/            # small helpers (formatting, validation)
    dev/              # developer-only screens (ThemePreview)
```

Import from `src/` with the `@/` alias: `import { colors } from '@/theme';`

### Theme rules

- Never hard-code colors, font names, or sizes in a component. Use `colors`, `textStyles`,
  `spacing`, and `radius` from `@/theme`, or a ready-made style from `sharedStyles`.
- To change the look of the app, edit the token in `src/theme/` and every screen updates.
- Custom fonts: set `fontFamily` (e.g. `fonts.bold`), not `fontWeight`. Android ignores
  `fontWeight` on custom fonts.

### Lint & format

```sh
npm run lint          # ESLint (expo config + Prettier); fails on any error or warning
npm run lint:fix      # auto-fix what can be fixed
npm run format        # Prettier write
npm run format:check  # Prettier check only
npm run typecheck     # tsc --noEmit
```

Run `npm run lint && npm run typecheck` before opening a PR. Install the recommended VS Code
extensions (ESLint, Prettier) to get format-on-save.
