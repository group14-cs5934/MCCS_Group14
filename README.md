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
