# AquaRun

Water refill ordering and daily delivery tracking portal for a local water refilling station.

## Run locally
The pages use JavaScript modules, so open the folder with a local server (for example the VS Code Live Server extension) and not by double-clicking an HTML file.

## Setup
1. Create a Supabase project.
2. Run the files in `sql/` in order (01 to 05) in the Supabase SQL editor.
3. Put the project URL and anon key in `js/config/supabaseClient.js`. Never add the service role key.

## Folders
- `customer/`, `staff/`, `rider/`, `admin/`: one HTML file per page, grouped by role
- `css/`: base, layout, components, and one small file per page that needs its own styles
- `js/`: `config/`, `core/`, `services/` (the only files that talk to Supabase), and `pages/` (one script per HTML page)
- `sql/`: database setup
- `assets/`: images and icons

## Deploy
Netlify, Vercel or GitHub Pages. No build step.
