# menU

menU is a small web app for a shared flat where one person cooks big meals and everyone else chooses whether to join. The cook posts meals with ingredients and a photo, flatmates opt in or out, the cost is split so the cook always pays less, and each flatmate can copy the cook's bank details one item at a time to pay. It runs as a single Cloudflare Worker with static assets and a D1 database (which also stores the photos), and deploys straight from GitHub. The layout adapts to phones, tablets and computers, and it can be added to a phone's home screen like an app.

## Repository Structure

```
menU/
├── public/
│   ├── index.html        App shell
│   ├── app.js            Single page front end (onboarding, home, calendar, bank, requests, pay)
│   ├── style.css         Mobile first styles, responsive breakpoints and dark mode
│   ├── manifest.json     Home screen app details
│   ├── logo.png          menU wordmark (logo-dark.png is the dark mode version)
│   └── icon-*.png        Tab and home screen icon (32, 192, 512) and apple-touch-icon.png
├── src/
│   ├── worker.js         Worker entry: /api/* to the API, everything else to public/
│   ├── api.js            All API routes, cost splitting and first run database setup
│   └── schema.js         Generated from schema.sql (run npm run gen after editing it)
├── functions/
│   └── api/[[path]].js   Optional Cloudflare Pages entry that re-exports the API
├── scripts/
│   └── gen-schema.mjs    Builds src/schema.js from schema.sql
├── schema.sql            Tables, default settings (including bank details) and default items
├── local-server.mjs      Zero install local runner (Node 22.5+), optional demo data
├── wrangler.toml         Worker, static assets and D1 binding
├── package.json          Scripts and wrangler dependency
└── README.md
```

## Features

| Feature | Description |
| --- | --- |
| Onboarding | Six short intro screens, then name, PIN and profile picture |
| Cook (admin) login | Password login that unlocks editing, the meal bank and payment confirmation |
| Home | Today's meal, upcoming meals and meals still waiting for a date, with price per person and opt in or out buttons |
| Calendar | Month view of scheduled meals; the cook can tap an empty day to add one |
| Meal editor | Name, notes, optional date, photo, ingredients with prices and a live running total |
| Optional dates | A meal can be added without a date; everyone sees it as "Date to be decided" until the cook sets one |
| Ingredient ticking | Anyone can tick an ingredient they already have; the price only counts what is still needed |
| Who has what | A ticked ingredient shows the profile picture and name of the person who has it. Only that person or the cook can untick it |
| Responsive layout | Bottom tab bar on phones, two column cards on tablets, a side menu and two column meal page on computers |
| Default items | About 90 common UK items with typical prices that autofill when you type an ingredient |
| Meal bank | Every meal cooked before, reusable in two taps with a new date |
| Requests | Flatmates suggest a meal with name, photo and ingredients; the cook schedules or removes it |
| Splitting | Everyone who opts in pays an equal share; the cook counts as half a share (configurable) |
| Pay page | What you owe, with each bank detail copyable on its own, and "I've paid" for the cook to confirm |

## How Pricing Works

Tesco has no public price API, so the catalogue is a snapshot of regular (non-Clubcard) prices read from tesco.com, dated in the header of `data/catalog.tsv`:

- About 270 items, each priced per real pack or unit ("1 tin" of chopped tomatoes 400g, "1 pack" of chicken breast 650g, "1 bag" of basmati 1kg) rather than per gram or kilo, so the quantity you type multiplies a real shelf price.
- Typing an ingredient name fills in the quantity as "1 <unit>" and the price. Change the quantity (for example "4 tins") and the price follows. Typing a price by hand stops the automatic maths for that row.
- Catalogue prices win. Prices remembered from saved meals are only offered for items that are not in the catalogue.
- To refresh or extend it, edit `data/catalog.tsv` (category, name, unit, pack, price in pounds, Tesco product name; tab separated), then run `npm run gen`. The catalogue reloads into the database automatically on the next request after you deploy, because its version changes.
- Each ingredient has a "Search Tesco" link that opens a Tesco search so you can check a price.
- The meal form shows a running total as you type prices. The meal total is the sum of ingredients that are not ticked, and the cook can override it with a fixed total at any time.

## How the Split Works

With a total T, N flatmates opted in and a cook share W (default 0.5), each flatmate pays T / (N + W) rounded up to the penny, and the cook pays whatever is left, which is about W of a share. The cook share can be changed under Profile, Splitting.

## Deploy to Cloudflare

The repository deploys with `npx wrangler deploy`, which is what Cloudflare's Git integration (Workers Builds) runs on every push to `main`.

1. In the Cloudflare dashboard go to Workers and Pages, create an application, import this GitHub repository and keep the default deploy command `npx wrangler deploy`. If the build reports a name mismatch, set `name` in `wrangler.toml` to the project name shown in the dashboard.
2. On the first deploy wrangler creates the D1 database from the binding in `wrangler.toml`. There is no separate image bucket; photos are stored in the database. The tables and the default item catalogue are created automatically on the first request, so there is nothing to run by hand.
3. In the Worker's Settings, find the Variables and Secrets section at the top (the runtime one, not the one under Build), add a Secret called `ADMIN_PASSWORD`, and deploy. This is the cook login password. Open `/api/config` on your site and check it shows `"configured":true`.
4. Optional: add a secret called `JOIN_CODE` so only people who know the code can sign up.
5. Open the `workers.dev` address shown at the top of the Worker's page in the dashboard.

If the build says it cannot create the database automatically, create a D1 database in the dashboard and add its `database_id` to `wrangler.toml`.

`wrangler.toml` sets `keep_vars = true`, so variables and secrets added in the dashboard are not removed when a build redeploys. The D1 database is named `flat-feast` in `wrangler.toml`; keep that name so the existing data stays attached.

To deploy from your own machine instead, run `npm install`, `npx wrangler login` and `npm run deploy`, then add the secrets as above.

Open the site, tap "Cook login" on the first screen and enter the admin password. Flatmates tap through the intro and create a profile.

## Local Development

Fastest way to view the app, with no Cloudflare account or installs (needs Node 22.5 or newer): run `node local-server.mjs --demo` and open http://localhost:8787. The demo flag adds sample flatmates (Alice, Bob, Cara, Dev, PIN 1234) and meals. Use the cook login with password `changeme`. Data is kept in a `.local` folder, which you can delete to reset.

To run it the way Cloudflare does, create a `.dev.vars` file containing `ADMIN_PASSWORD=changeme`, then run `npm install` and `npm run dev`.

## Notes

- Bank details are seeded from `schema.sql` and can be edited by the cook under Profile. If this repository is public, replace them in `schema.sql` with placeholders, run `npm run gen`, and enter the real ones in the app instead.
- Sign in is a name and PIN, which suits a trusted flat. It is not designed to protect anything highly sensitive.
- Meals can only be opted in or out of until their date; money owed is calculated from the day of the meal onwards.
- Databases created before the "who has what" feature get the extra column added automatically on the first request.

## Concepts Covered

- A Cloudflare Worker serving static assets and an API
- A D1 binding with automatic provisioning, first run schema setup, and photos stored as base64 rows
- Cookie sessions and admin versus user permissions
- Hash routed single page app in vanilla JavaScript
- Responsive layout with CSS grid, breakpoints and a sidebar that becomes a bottom bar on phones
- Automatic database migration for an added column
- Client side image resizing before upload
- Cost splitting with penny rounding and a reduced cook share
- Bulk queries to stay inside D1 per request query limits

## Author

Michael Jones
