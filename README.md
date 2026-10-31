# Transport Fever 3 Vehicles

Static site listing every Transport Fever 3 vehicle with its stats, generated from the CSV files in `data/`.

## Build locally

```sh
pdm install
pdm run build   # writes the site into site/
pdm run serve   # http://localhost:8000
```

## Layout

- `data/` — one CSV per vehicle category
- `build.py` — reads the CSVs and renders the templates
- `templates/` — Jinja2 templates (`base.html`, `index.html`, `category.html`)
- `static/` — CSS (light/dark themes), JS (theme switch, table sorting and filters), favicon and the social preview image
- `assets/og-image.svg` — source of `static/og-image.png`; after editing it, re-render on macOS with
  `sips -s format png assets/og-image.svg --out static/og-image.png`

The site address used for canonical links, the sitemap and social previews is `SITE_URL` in `build.py`.

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`, which builds the site and publishes it.
In the repository settings set **Pages → Source** to **GitHub Actions** once.
