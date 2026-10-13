# Flat Feast

A small web app for a shared flat where one person cooks big meals and everyone else chooses whether to join. The cook posts meals with ingredients and a photo, flatmates opt in or out, the cost is split so the cook always pays less, and each flatmate can copy the cook's bank details one item at a time to pay. It runs as a Cloudflare Worker with static assets, D1 for data and R2 for images.

## Repository Structure

```
flat-feast/
├── public/
│   ├── index.html        App shell
│   ├── app.js            Single page front end (onboarding, home, calendar, bank, requests, pay)
│   └── style.css         Mobile first styles with dark mode
├── src/
│   ├── worker.js         Worker entry: routes /api to the API, creates tables on first run
│   └── api.js            All API routes (auth, meals, RSVP, split, payments)
├── local-server.mjs      Zero install local runner (Node 22.5+), optional demo data
├── schema.sql            D1 tables and default settings (including bank details)
├── wrangler.toml         Worker config, static assets, D1 and R2 bindings
├── package.json          Dev and deploy scripts
└── README.md
```

## Features

| Feature | Description |
| --- | --- |
| Onboarding | Six short intro screens, then name, PIN and profile picture |
| Cook (admin) login | Password login that unlocks editing, the meal bank and payment confirmation |
| Home | Today's meal and upcoming meals with price per person and opt in or out buttons |
| Calendar | Month view of scheduled meals; the cook can tap an empty day to add one |
| Meal editor | Name, notes, date, photo, ingredients with estimated prices, optional fixed total |
| Ingredient ticking | Anyone can tick an ingredient they already have; the price only counts what is still needed |
| Meal bank | Every meal cooked before, reusable in two taps with a new date |
| Requests | Flatmates suggest a meal with name, photo and ingredients; the cook schedules or removes it |
| Splitting | Everyone who opts in pays an equal share; the cook counts as half a share (configurable) |
| Pay page | What you owe, with each bank detail copyable on its own, and "I've paid" for the cook to confirm |

## How Pricing Works

Tesco and Co-op do not offer a public price API, and scraping their sites is unreliable and against their terms, so prices are estimates. To make that quick:

- A built-in catalogue of about 90 common UK items (chicken, mince, pasta, tinned tomatoes, spices and so on) ships with typical supermarket prices. These are rough estimates, not live prices. They are stored in the `catalog` table in `schema.sql`, so edit or add rows there.
- Typing an ingredient name fills in its price and quantity from the catalogue.
- Every price you enter on a saved meal is remembered and takes priority over the catalogue next time.
- Each ingredient has a "Search Tesco" link that opens a Tesco search so you can check a price.
- The meal total is the sum of ingredients that are not ticked. You can override it with a fixed total at any time.

## How the Split Works

With a total T, N flatmates opted in and a cook share W (default 0.5), each flatmate pays T / (N + W) rounded up to the penny, and the cook pays whatever is left, which is about W of a share. The cook share can be changed under Profile, Splitting.

## Deploy to Cloudflare

The repository deploys with `npx wrangler deploy`, which is what Cloudflare's Git integration (Workers Builds) runs.

1. In the Cloudflare dashboard go to Workers & Pages, create an application, import this GitHub repository and keep the default deploy command `npx wrangler deploy`. If the build reports a name mismatch, set `name` in `wrangler.toml` to the project name shown in the dashboard.
2. On the first deploy wrangler creates the D1 database and R2 bucket from the bindings in `wrangler.toml`. The tables and the default item catalogue are created automatically on the first request.
3. In the Worker's Settings, Variables and Secrets, add a secret called `ADMIN_PASSWORD`. This is the cook login password.
4. Optional: add a secret called `JOIN_CODE` so only people who know the code can sign up.
5. Open the `workers.dev` address shown at the top of the Worker's page in the dashboard. Every push to `main` redeploys.

To deploy from your own machine instead, run `npm install`, `npx wrangler login` and `npm run deploy`, then add the secrets as above.

Open the site, tap "Cook login" on the first screen and enter the admin password. Flatmates tap through the intro and create a profile.

## Local Development

Fastest way to view the app, with no Cloudflare account or installs (needs Node 22.5 or newer): run `node local-server.mjs --demo` and open http://localhost:8787. The demo flag adds sample flatmates (Alice, Bob, Cara, Dev, PIN 1234) and meals. Use the cook login with password `changeme`. Data is kept in a `.local` folder.

To run it the way Cloudflare does, create a `.dev.vars` file containing `ADMIN_PASSWORD=changeme`, then run `npm install` and `npm run dev`.

## Notes

- Bank details are seeded from `schema.sql` and can be edited by the cook under Profile. Change them in `schema.sql` before running it if you do not want the defaults.
- Sign in is a name and PIN, which suits a trusted flat. It is not designed to protect anything highly sensitive.
- Meals can only be opted in or out of until their date; money owed is calculated from the day of the meal onwards.

## Concepts Covered

- Cloudflare Workers with static assets, D1 and R2 bindings, and automatic resource provisioning
- Cookie sessions and admin versus user permissions
- Hash routed single page app in vanilla JavaScript
- Client side image resizing before upload
- Cost splitting with penny rounding and a reduced cook share
- Bulk queries to stay inside D1 per request query limits
- Creating the database schema lazily on first request

## Author

Michael Jones
