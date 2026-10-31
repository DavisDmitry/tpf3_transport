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
- `static/` — CSS (light/dark themes) and JS (theme switch, table sorting and filters)

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`, which builds the site and publishes it.
In the repository settings set **Pages → Source** to **GitHub Actions** once.
