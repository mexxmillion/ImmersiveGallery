# Immersive Gallery

Web gallery MVP for publishing selected 3D Gaussian Splat scenes from the local
Immersive Memories workstation.

The local app remains the source of truth for generation, reconstruction,
curation, rating, and album management. This repo is the shareable web product:
a gallery viewer today, and later the hosted control panel for uploads,
permissions, and site management.

## Current Milestone

This repo currently includes:

- Static Vite + PlayCanvas gallery app.
- SOG-first scene loading with WebXR support.
- Sample album generated from `E:\git\ImmersiveMemories`.
- Ten local PLY scenes converted to bundled `.sog` files.
- HTTPS dev serving for Meta Quest testing.
- Upload-ready folder structure under `public/albums`.
- `/admin` control panel UI.
- Cloudflare Worker API scaffold.
- D1 schema for users, roles, albums, scenes, permissions, comments, and likes.
- R2 binding placeholders for future scene asset storage.
- Cloudflare Access / Google OAuth identity plumbing.

Observed sample compression:

| Scene | Source PLY | SOG |
|---|---:|---:|
| `sample_mountain` | 66.1 MB | 11.1 MB |
| `sample_room_2` | 66.1 MB | 11.9 MB |
| `zimage_res4lyf_hidetail_00070` | 66.1 MB | 11.1 MB |

The current `public/albums` sample payload is about 106 MB for ten scenes plus
thumbnails and manifests.

## Local Test

```powershell
npm install
npm run seed
npm run convert:sog
npm run seed
npm run dev
```

Open the Vite URL printed by the dev server.

For Meta Quest or any device on the LAN, serve over HTTPS:

```powershell
$env:HTTPS=1; $env:PORT=5175; npm run dev
```

Then open:

```text
https://<this-PC-LAN-IP>:5175
```

The headset/browser will likely require accepting the self-signed certificate
once. WebXR needs HTTPS on non-localhost addresses.

`npm run seed` copies a few sample scenes from `E:\git\ImmersiveMemories` into:

```text
public/albums/demo/
  album.json
  cover.jpg
  scenes/<scene-id>/
    scene.json
    thumb.jpg
    scene.ply
    scene.sog
```

The second `npm run seed` refreshes manifests after SOG files are created so the
viewer prefers `scene.sog`. Once SOG exists, the seed script does not recopy PLY
unless a PLY fallback is missing and no SOG exists.

## Upload Shape

For the first hosted test, upload the built site and the `public/albums` folder
as static assets. The intended production path is Cloudflare Pages for the app,
Cloudflare R2 for `albums/`, and Cloudflare Access in front of both viewer and
asset URLs.

Actual cloud publishing needs your Cloudflare/R2 credentials or an existing
`rclone` remote. Until then, the repo is locally testable and upload-ready.

## Control Panel

The control panel route is:

```text
/admin
```

Before Cloudflare bindings are enabled, it runs in static preview mode and reads
the existing `public/albums` manifests. After D1/R2/Access are configured, it can
read from the Worker API.

Local static UI test:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5174/admin
```

Worker/API local test:

```powershell
npm run worker:dev
```

## Cloudflare Worker Setup

This repo has a Worker entrypoint at `worker/index.js` and a `wrangler.jsonc`
configured for Workers Static Assets.

Build and deploy:

```powershell
npm run worker:deploy
```

Current `wrangler.jsonc` deploys static assets and API routes without D1/R2
bindings. After creating the Cloudflare resources below, uncomment the D1 and R2
binding blocks in `wrangler.jsonc`.

### D1

Create the database:

```powershell
npx wrangler d1 create immersive_gallery
```

Copy the returned `database_id` into `wrangler.jsonc`, then run:

```powershell
npm run db:migrate:remote
```

For local D1 testing:

```powershell
npm run db:migrate:local
```

### R2

Create an R2 bucket named:

```text
immersive-gallery-prod
```

Then uncomment the `r2_buckets` section in `wrangler.jsonc`.

Initial R2 object convention:

```text
albums/<album-id>/cover.jpg
albums/<album-id>/scenes/<scene-id>/thumb.jpg
albums/<album-id>/scenes/<scene-id>/scene.sog
```

The current upload UI/API is a scaffold. For the first production pass, SOG
conversion still happens locally, then final assets are uploaded/synced to R2.

### Google OAuth / Cloudflare Access

In Cloudflare Zero Trust:

1. Add Google as an identity provider.
2. Create an Access application for the gallery domain.
3. Allow your admin email and the first few test viewer emails.
4. Set `ADMIN_EMAILS` in `wrangler.jsonc` or as a Worker environment variable.
5. Set `ACCESS_TEAM_DOMAIN` to your team domain, for example:

```text
your-team.cloudflareaccess.com
```

The Worker checks Cloudflare Access identity and maps configured admin emails to
the `admin` role. When D1 is enabled, first login creates/updates the user row.

## Local Scene Publisher

For simple single-image publishing, you do not need to ingest into
ImmersiveMemories first. Use the local publisher:

```powershell
npm run prepare:dev
```

Open:

```text
http://127.0.0.1:5174/prepare
```

Then drag/drop images. Each image becomes:

```text
public/albums/<album-id>/scenes/<scene-id>/
  thumb.jpg
  scene.sog
  scene.json
```

The local publisher does:

1. Save the uploaded image into `.local/uploads`.
2. Run Apple SHARP locally through the configured Python environment.
3. Normalize the SHARP PLY.
4. Convert PLY to bundled SOG with `@playcanvas/splat-transform`.
5. Delete the temporary PLY.
6. Refresh `album.json` and `albums/index.json`.

Default processor paths:

```text
MEMORIES_ROOT=E:\git\ImmersiveMemories
SHARP_PYTHON=E:\git\ImmersiveMemories\.venv\Scripts\python.exe
PREPARE_API_PORT=5199
```

Override them if needed:

```powershell
$env:MEMORIES_ROOT="E:\git\ImmersiveMemories"
$env:SHARP_PYTHON="E:\git\ImmersiveMemories\.venv\Scripts\python.exe"
npm run prepare:dev
```

This is independent from the ImmersiveMemories UI, but currently reuses its
installed SHARP environment and model cache so the web publisher does not
duplicate large dependencies.

### Local Admin Lock

For local destructive controls, start with a PIN:

```powershell
$env:LOCAL_ADMIN_PIN="change-this"
npm run prepare:dev
```

Then open `/admin` and click **Unlock**. Public viewers never see admin controls
unless they visit the admin route on your local machine and know the PIN. Hosted
production should use Cloudflare Access + Google OAuth instead.

### Daily Local Publishing Flow

```text
/prepare
  drag/drop images
  watch SHARP -> SOG job status

/admin
  unlock
  rename/archive/delete/publish scenes
  inspect processing queue
  inspect git changes
  Commit & Push

Cloudflare
  redeploys from GitHub
```

Archive keeps files but hides the scene from the viewer. Delete removes the local
scene folder. Commit & Push stages `public/albums`, commits it, and pushes to
`origin/main`.

## Product Direction

Immersive Gallery should become the hosted web version of the local experience.
It should have two surfaces:

### Viewer App

The viewer is what invited users see.

- Browse albums and scenes.
- Open SOG scenes in the PlayCanvas viewer.
- Enter WebXR/VR on supported headsets.
- Search/filter published scenes.
- Respect user permissions from the backend.
- Optional later: likes and comments.

### Control Panel

The control panel is curator/admin only.

- Upload scene assets, covers, and thumbnails.
- Create, edit, publish, unpublish, archive, and delete albums.
- Create, edit, publish, unpublish, archive, and delete scenes.
- Reorder scenes inside albums.
- Manage scene titles, notes, tags, and visibility.
- Invite users by email.
- Assign roles such as viewer, commenter, curator, and admin.
- Control per-album and later per-scene permissions.
- Review basic upload and publishing status.

## Target Architecture

The planned hosted architecture is:

```text
ImmersiveMemories local workstation
  - reconstruction
  - curation
  - PLY -> SOG conversion
  - local source of truth for heavy generation work
        |
        | upload / sync / browser control panel
        v
Cloudflare Pages
  - viewer app
  - admin control panel
        |
        v
Cloudflare Worker API
  - auth identity validation
  - permission checks
  - signed/direct upload flow
  - metadata API
        |
        +--> Cloudflare R2
        |     - scene.sog
        |     - thumbnails
        |     - covers
        |
        +--> Cloudflare D1
              - users
              - roles
              - albums
              - scenes
              - permissions
              - comments/likes later
```

## Auth And Permissions

Start with Google OAuth through Cloudflare Access:

- Google handles user identity.
- Cloudflare Access protects the web app and admin routes.
- The Worker reads the verified Access identity.
- D1 stores site-specific roles and permissions.

Initial roles:

| Role | Purpose |
|---|---|
| `viewer` | Can view permitted albums and scenes. |
| `commenter` | Can view and add comments/likes once enabled. |
| `curator` | Can manage albums/scenes and publish content. |
| `admin` | Can manage users, roles, permissions, and site settings. |

Initial permission model:

- Site admins can access everything.
- Curators can manage content.
- Viewers see only albums they are allowed to access.
- Album-level permissions come first.
- Scene-level overrides can be added later if needed.

## Implementation Roadmap

### Phase 1 - Hosted Static MVP

- Deploy current viewer to Cloudflare Pages.
- Put `public/albums` assets in R2 or Pages static assets for the first test.
- Protect the site with Cloudflare Access and Google OAuth.
- Verify desktop and Meta Quest loading through HTTPS.

### Phase 2 - Worker And D1 Foundation

- Add Cloudflare Worker API.
- Add D1 schema for users, roles, albums, scenes, and permissions.
- Let the viewer read from API responses instead of only static JSON.
- Keep static JSON fallback for local development.

### Phase 3 - Control Panel MVP

- Add `/admin`.
- Require curator/admin permission.
- Manage albums and scenes.
- Publish, unpublish, archive, delete, reorder, and edit metadata.
- Keep SOG conversion local for now.

### Phase 4 - Upload Flow

- Add browser upload through Worker-created R2 upload URLs.
- Support SOG, thumbnails, and covers first.
- Allow PLY upload only if conversion remains local/manual or if a later
  conversion service is added.
- Add validation for required scene files and metadata.

### Phase 5 - User Invites And Permissions

- Add invite-by-email flow.
- Add role assignment UI.
- Add album permission UI.
- Add audit-friendly status for who can see each album.

### Phase 6 - Comments And Likes

- Add D1-backed likes and comments.
- Keep comments permission-gated.
- Add moderation/delete controls for curator/admin.

## Notes

- PLY-to-SOG conversion currently uses `@playcanvas/splat-transform`.
- SOG conversion should stay local until cloud conversion is explicitly needed.
- R2 should store final delivery assets, not become the only source of truth.
- Avoid storing permanent write credentials in the browser.
