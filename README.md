# Recipient Map USA

A static website showing who received US federal grants and similar funding from January to September 2024, by state and county. A listing shows who received money. It says nothing about misuse.

## What is in this folder

- `site/` is the finished website. This is the only folder a host needs.
- `web/` holds the site's script, styles and icon.
- `pipeline/` holds the scripts that rebuild the data and pages.

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

Needs Python 3.11 or later and `pip install duckdb`.

Download `federal_grants/_year=2024/data_0.parquet` from the [SomaliScan archive](https://huggingface.co/datasets/somaliscan/spending-archive), then run:

```bash
python pipeline/build_data.py data_0.parquet site_data
CONTACT="you@example.com" SITE_URL="https://your-site.pages.dev" python pipeline/build_site.py site_data site
```

`SITE_URL` turns on the preview image for links shared on social media.
