# Contributing to passanger

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- npm (comes with Node.js)

## Development Setup

```sh
git clone https://github.com/csabagura/passanger.git
cd passanger
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with hot module replacement.

## Project Structure

```
src/
  routes/          # SvelteKit pages and layouts
  lib/
    components/    # Reusable Svelte components (shadcn-svelte based)
    db/            # Dexie.js database schema and repository layer
    utils/         # Shared utilities and helpers
```

Tests are co-located with source files (e.g., `Component.test.ts` next to `Component.svelte`).

## Available Scripts

| Script                   | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `npm run dev`            | Start development server with HMR                |
| `npm run build`          | Create production build (static adapter)         |
| `npm run preview`        | Preview the production build locally             |
| `npm run check`          | SvelteKit sync + svelte-check type validation    |
| `npm run lint`           | Prettier formatting check + ESLint               |
| `npm run format`         | Auto-format all files with Prettier              |
| `npm test`               | Run unit tests (Vitest)                          |
| `npm run test:artifacts` | Validate build artifacts (manifest, SW, headers) |
| `npm run test:a11y`      | Accessibility tests (Playwright + axe-core)      |

## Code Style

- **Prettier** and **ESLint** are enforced in CI — run `npm run lint` before pushing
- Use **Svelte 5 runes** (`$state`, `$derived`, `$effect`) — not legacy reactive statements
- Follow existing component patterns (shadcn-svelte primitives, Tailwind utility classes)
- Tests are co-located: place `*.test.ts` files next to the code they test

## Testing

### Unit tests (Vitest)

```sh
npm test              # Run all unit tests
npm run test:watch    # Watch mode during development
```

### Build artifact tests

```sh
npm run test:artifacts
```

Validates PWA manifest, service worker registration, security headers, and bundle budgets.

### Accessibility tests (Playwright + axe-core)

```sh
npm run test:a11y
```

Runs WCAG 2.1 AA audits on all routes, keyboard navigation, and reduced motion checks. Requires a production build (`npm run build` first).

### CI pipeline order

The full CI pipeline runs: audit → check → lint → test → build → test:artifacts → a11y → Lighthouse. Run all quality gates locally before opening a PR:

```sh
npm run check && npm run lint && npm test && npm run build && npm run test:artifacts
```

## Branch & PR Workflow

This project uses **trunk-based development** with short-lived branches from `main`.

### Branch naming

- `feat/short-description` — new features
- `fix/short-description` — bug fixes
- `docs/short-description` — documentation changes

### PR process

1. Fork the repository
2. Create a branch from `main` (e.g., `feat/dark-mode`)
3. Implement your changes
4. Run all quality gates locally (see CI pipeline order above)
5. Open a pull request to `main`
6. Fill out the PR template — describe changes, link related issues, confirm test plan

PRs are reviewed for correctness, code style consistency, and test coverage. Use `npm ci` (not `npm install`) for reproducible builds matching CI.
