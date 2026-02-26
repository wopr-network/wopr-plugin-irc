# wopr-plugin-irc

`@wopr-network/wopr-plugin-irc` — IRC channel plugin for WOPR.

## Commands

```bash
npm run build     # tsc
npm run dev       # tsc --watch
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

**Linter/formatter is Biome.** Never add ESLint/Prettier config.

## Architecture

```
src/
  index.ts              # Plugin entry — exports WOPRPlugin default
  channel-provider.ts   # Implements ChannelProvider interface
  message-utils.ts      # IRC message splitting, formatting, flood control
  logger.ts             # Winston logger instance
  types.ts              # Re-exports from @wopr-network/plugin-types + IRC-specific types
  irc-framework.d.ts    # Type declarations for irc-framework
```

## Plugin Contract

This plugin imports ONLY from `@wopr-network/plugin-types` — never from wopr core internals.

```typescript
import type { WOPRPlugin, WOPRPluginContext, ChannelProvider } from "@wopr-network/plugin-types";
```

The default export must satisfy `WOPRPlugin`. The plugin receives `WOPRPluginContext` at `init()` time.

## Key Conventions

- irc-framework v4 for IRC connectivity
- Winston for logging (not console.log)
- Node >= 22, ESM (`"type": "module"`)
- Conventional commits with issue key: `feat: add voice support (WOP-123)`
- `npm run check` must pass before every commit

## Issue Tracking

All issues in **Linear** (team: WOPR). No GitHub issues. Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-irc`.
