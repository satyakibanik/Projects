# BEGD deployment note

This folder contains the static dashboard interface. It requests report data from same-origin `/api/*` endpoints. GitHub Pages cannot run those endpoints. To enable live reports and real-time readings, deploy the BEGD Python service and dashboard together on an API-capable host. The JSON files in `data/` are archived examples; the live dashboard does not load them as its report API.
