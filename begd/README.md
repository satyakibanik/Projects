# BEGD live deployment

The dashboard and API are served together by `scripts/server.py`. It serves the repository homepage at `/`, the dashboard at `/begd/`, and live report endpoints under `/api/`.

The root `render.yaml` defines a Render web service for this repository. After this branch is merged, create a Blueprint in Render from `satyakibanik/satyakibanik` and apply it. The service's public URL is `https://begd-live-satyakibanik.onrender.com`; the dashboard will be at `/begd/`. The homepage at GitHub Pages links to the live service.

The default Blueprint plan is free. Render free web services sleep after 15 minutes without requests, so the first visit after idle can take about a minute. Choose a paid service plan in Render if you need it to stay warm continuously.

The API reads current reports from Power Grid Bangladesh's public ERP archive and keeps short-lived in-memory caches. The JSON files in `data/` are archived examples and are not used by the live API.
