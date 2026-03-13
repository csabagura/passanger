# passanger

Offline-first PWA for tracking vehicle fuel consumption, maintenance costs, and driving statistics.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/csabagura/passanger)

## Features

- **Fuel logging** — record fill-ups with automatic cost-per-litre/gallon and consumption calculations
- **Maintenance tracking** — log service visits, repairs, and associated costs
- **History & filtering** — browse all entries with type filters and monthly grouping
- **Statistics** — view running totals, averages, and breakdowns by time period
- **CSV export** — download your data for external analysis
- **Settings** — choose fuel unit (litres / gallons) and currency
- **Offline-first** — works without an internet connection; all data stored locally on your device
- **Installable PWA** — add to your home screen for a native app experience

## Tech Stack

| Technology                                           | Purpose                                |
| ---------------------------------------------------- | -------------------------------------- |
| [SvelteKit](https://svelte.dev/docs/kit)             | Application framework (static adapter) |
| [TypeScript](https://www.typescriptlang.org/)        | Type safety                            |
| [Tailwind CSS v4](https://tailwindcss.com/)          | Utility-first styling                  |
| [shadcn-svelte](https://www.shadcn-svelte.com/)      | UI component library                   |
| [Dexie.js](https://dexie.org/)                       | IndexedDB wrapper for offline storage  |
| [Workbox](https://developer.chrome.com/docs/workbox) | Service worker and PWA caching         |

## Quick Start

```sh
git clone https://github.com/csabagura/passanger.git
cd passanger
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## Available Scripts

| Script                   | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `npm run dev`            | Start development server                         |
| `npm run build`          | Create production build                          |
| `npm run preview`        | Preview production build locally                 |
| `npm run check`          | Run SvelteKit sync and svelte-check              |
| `npm run lint`           | Check formatting (Prettier) and linting (ESLint) |
| `npm run format`         | Auto-format code with Prettier                   |
| `npm test`               | Run unit tests (Vitest)                          |
| `npm run test:artifacts` | Run build artifact validation tests              |
| `npm run test:a11y`      | Run accessibility tests (Playwright + axe-core)  |

## Self-Hosting / Deploy

### One-click deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/csabagura/passanger)

The deploy button forks this repository and deploys it as a Cloudflare Worker with Static Assets. No server-side code is required — the app is fully static.

### Manual deployment

1. Fork this repository
2. Install dependencies: `npm ci`
3. Build: `npm run build`
4. Deploy the `build/` directory to any static hosting provider (Cloudflare, Netlify, Vercel, GitHub Pages, etc.)

For Cloudflare Workers specifically:

```sh
npx wrangler deploy
```

## Browser Support

| Browser        | Minimum Version |
| -------------- | --------------- |
| Chrome         | 90+             |
| Firefox        | 90+             |
| Safari         | 15+             |
| Edge           | 90+             |
| iOS Safari     | 15+             |
| Chrome Android | 90+             |

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) for details on development setup, code style, testing, and the PR process.

## License

This project is licensed under the [MIT License](./LICENSE).
