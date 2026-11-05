# Recipient Map USA

A static website showing who received US federal grants in fiscal year 2025 (October 2024 to September 2025), by state and county, using official data from the free [USAspending.gov API](https://api.usaspending.gov/). A listing shows who received money. It says nothing about misuse.

The map can be colored by total, per person, or change since the year before, filtered by funding agency, and zoomed and dragged.

## What is in this folder

- `site/` is the finished website. This is the only folder a host needs.
- `web/` holds the site's script, styles and icon.
- `pipeline/` holds the scripts that rebuild the data and pages.
- `.github/workflows/refresh-data.yml` refreshes the data from USAspending.gov on the 5th of each month and commits it, so the site stays current on its own. You can also run it from the **Actions** tab.

## Deploy with GitHub and Cloudflare (recommended)

1. Create a GitHub repository and push this folder to it.
2. In Cloudflare, open **Workers & Pages**, then **Create application**.
3. Choose **Pages**, then **Connect to Git**, and select the repository.
4. Leave **Build command** empty and set **Build output directory** to `site`.
5. Select **Save and Deploy**.

Your site appears at a free `pages.dev` address. Every push to `main` updates it.

If Cloudflare offers a Worker instead of Pages, you can use it. `wrangler.toml` already points at `site/`.

## Deploy with GitHub and Netlify

1. In Netlify, choose **Add new project**, then **Import an existing project**.
2. Select the GitHub repository. `netlify.toml` sets the publish folder to `site`.
3. Deploy.

The Free plan pauses sites when its monthly credits run out, so check usage if traffic grows.

## Test without GitHub

Drag the `site` folder into Netlify Drop or a Cloudflare Pages direct upload. A Cloudflare direct-upload project can't be switched to Git later.

Don't open `site/index.html` by double-clicking it. Browsers block its data files that way. To preview on your computer, run `python -m http.server --directory site 8000` and visit `http://localhost:8000`.

## Before you go public

- Add a corrections contact, then rebuild (see below). The About page shows it.
- Read the listings for names of private people. The filter is automatic and can miss some.
- Get legal advice if you plan to add any label beyond who received money.

## Rebuild

Needs only Python 3.10 or later; no packages and no API key.

```bash
python pipeline/fetch_data.py site_data
CONTACT="you@example.com" SITE_URL="https://your-site.pages.dev" python pipeline/build_site.py site_data site
```

The fetch makes about 3,300 requests to the USAspending.gov API and takes roughly 10 to 20 minutes. Responses are cached in `pipeline/.cache`, so a rerun after an error picks up where it stopped; delete that folder to pull fresh numbers. Set `FY=2026` to show a different fiscal year.

`SITE_URL` turns on the preview image for links shared on social media. For the monthly GitHub refresh, set `CONTACT` and `SITE_URL` as repository variables under **Settings → Secrets and variables → Actions → Variables**.
