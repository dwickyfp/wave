# Wave Chatbot – Copilot Instructions

## Architecture Overview

Next.js 16 App Router application (`src/app/`) with three route groups:

- `(auth)/` – public sign-in/sign-up pages
- `(chat)/` – protected chat UI, agents, MCP, workflow builder
- `api/` – REST API routes; each domain folder has `route.ts` + `actions.ts` for business logic

**Data flow**: UI → Zustand store (`src/app/store/index.ts`, key `mc-app-store-v2.0.1`) → SWR hooks (`src/hooks/queries/`) → API routes → Repository layer (`src/lib/db/pg/repositories/`) → Drizzle ORM → PostgreSQL.

**AI inference**: `POST /api/chat` streams via Vercel AI SDK (`ai@6`). Model instances are defined in `src/lib/ai/models.ts`; tool implementations live in `src/lib/ai/tools/`. MCP servers are connected via SSE/Stdio transports in `src/lib/ai/mcp/`.

## Key Directories

| Path                          | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `src/lib/db/pg/schema.pg.ts`  | Single source of truth for all DB tables                                    |
| `src/lib/db/pg/repositories/` | One repository class per domain (agents, chats, MCP, workflows…)            |
| `src/lib/ai/`                 | AI provider setup, model registry, tool kit, MCP client                     |
| `src/lib/auth/`               | Better Auth config; `auth-instance.ts` (server), `client.ts` (browser-safe) |
| `src/types/`                  | Shared TypeScript types; Zod schemas in `src/lib/validations/`              |
| `src/app/store/`              | Zustand stores – `index.ts` (global app state), `workflow.store.ts`         |
| `messages/`                   | i18n JSON files for 7 locales (next-intl)                                   |

## Developer Workflows

```bash
pnpm dev                  # Local dev server
pnpm dev:https            # HTTPS mode – required to test OAuth locally
pnpm build && pnpm start  # Production
pnpm check                # lint + type-check + tests – must pass before PR

# Database (Drizzle Kit)
pnpm db:push              # Push schema changes without migration files
pnpm db:generate          # Generate migration files
pnpm db:migrate           # Run migrations
pnpm db:studio            # Interactive DB browser

# Docker (full local stack)
pnpm docker-compose:up / :down

# Tests
pnpm test                 # Vitest unit tests
pnpm test:e2e             # Playwright E2E (app must be running or started via playwright.config.ts)
```

Copy `.env.example` → `.env`; never commit secrets. Set `NO_HTTPS=1` for local HTTP.

## Project-Specific Conventions

**Repository pattern**: Never query the DB directly from API routes. Always go through a repository in `src/lib/db/pg/repositories/`. Each repository exposes focused methods; see `pgAgentRepository` for a typical example.

**Validation**: Use Zod for all API input validation. Schemas live in `src/lib/validations/`; reuse them on both client (form schemas) and server (API route parsing).

**Auth**: Import server-side auth utilities from `src/lib/auth/server.ts` (tagged `server-only`). Never import this in client components – use `src/lib/auth/client.ts` for browser code.

**Secrets protection**: React experimental `taintUniqueValue` is active (`next.config.ts` `experimental.taint: true`) – do not pass raw secret strings through Server Component props.

**Zustand persistence**: Only serialisable, UI-preference fields are persisted (`chatModel`, `toolChoice`, `allowedMcpServers`, `toolPresets`). Thread/message data is fetched fresh via SWR on load.

**Component naming**: `PascalCase.tsx` for components; `camelCase.ts` for hooks (`useX`) and utilities. Co-locate unit tests (`*.test.ts(x)`) next to source; larger integration suites go under `tests/`.

**Tailwind CSS 4** is used – configuration is CSS-based (`app/globals.css`), not `tailwind.config.js`.

## Adding a New Feature (typical steps)

1. Add/update table in `src/lib/db/pg/schema.pg.ts`, run `pnpm db:push`.
2. Create or extend a repository in `src/lib/db/pg/repositories/`.
3. Add Zod schema to `src/lib/validations/`.
4. Add API route (`route.ts`) and server action (`actions.ts`) under `src/app/api/<domain>/`.
5. Add SWR hook under `src/hooks/queries/` if the feature needs client-side data fetching.
6. Wire UI components under `src/components/` or the relevant route page.
7. Run `pnpm check` before committing.

## Commit & Branch Conventions

Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
Branches: `feat/…`, `fix/…`, `chore/…`.
PR checklist: `pnpm check` passes, screenshots for UI changes, linked issue.
