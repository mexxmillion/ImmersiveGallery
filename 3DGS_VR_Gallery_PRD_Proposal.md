# 3DGS VR Gallery Web Sharing Platform

**Product Requirements Document + Technical Proposal**  
Prepared: 2026-05-18

## 1. Executive Summary

The product is a lightweight web-sharing layer for curated 3D Gaussian Splatting (3DGS) VR galleries. The existing local pipeline remains responsible for ingest, SHARP-based reconstruction, rating, album assembly, and curation. The proposed web layer focuses only on publishing selected albums, storing optimized splat delivery files, authenticating viewers, and presenting scenes through a PlayCanvas/WebXR viewer.

The recommended MVP avoids a custom cloud CMS. It uses Cloudflare Pages for the viewer, Cloudflare R2 for optimized splat assets, Cloudflare Access for OAuth-style gatekeeping, and rclone/Cyberduck or a simple export command for publishing. A custom admin UI and database should be deferred until multi-curator management, per-user permissions, or public monetization becomes necessary.

| Decision Area | Recommendation | Reason |
|---|---|---|
| Frontend viewer | Cloudflare Pages + PlayCanvas/WebXR | Static delivery, fast global edge, minimal backend surface. |
| Asset storage | Cloudflare R2 | S3-compatible object storage with free egress and low storage/operation cost. |
| Splat delivery format | PlayCanvas SOG where possible | SOG is designed for web delivery and typically 15-20x smaller than equivalent PLY. |
| Authentication | Cloudflare Access first | No custom OAuth code for MVP; protect the full viewer/assets path. |
| Management | Local export + rclone sync first | Keeps the existing local curation tool as source of truth. |
| Metadata | JSON manifests first; D1 later | Albums need simple metadata first, not a relational backend. |

## 2. Proposal

### 2.1 Objective

Create a secure, low-cost, web-accessible 3DGS VR gallery that allows the owner/curator to publish selected splat albums from a local pipeline and allow invited users to view them through a browser or VR headset such as Meta Quest.

### 2.2 Product Positioning

This is not a cloud ingest platform. It is a curated publishing and viewing system. The core philosophy is to keep expensive, experimental, and failure-prone reconstruction work local while making the final curated result easy to distribute.

- **Keep local:** SHARP ingest, reconstruction, rating, album selection, heavy source assets, archival PLY, export logic.
- **Move online:** viewer app, optimized delivery assets, gallery manifests, thumbnails, lightweight access control.
- **Avoid initially:** cloud reconstruction, user uploads, social features, comments, payments, unnecessary database complexity.

### 2.3 Target Users

| User Type | Need | Primary Experience |
|---|---|---|
| Curator / Owner | Publish selected scenes and albums without rebuilding the existing local pipeline. | Export curated album locally, sync to cloud, share protected URL. |
| Invited Viewer | Open gallery easily on desktop, mobile, or Quest-class headset. | Authenticate, choose album, enter immersive scene viewer. |
| Future Admin / Collaborator | Manage albums and metadata from browser. | Use web admin UI if/when multi-curator workflows are needed. |

### 2.4 Business / Project Rationale

- Makes curated 3DGS/VR scenes shareable without shipping files manually.
- Keeps cloud cost predictable by separating final delivery assets from local ingest/reconstruction.
- Avoids premature custom backend work while preserving a clean upgrade path to a CMS-like admin tool.
- Supports portfolio, client preview, private art/gallery, family archive, or controlled research-demo use cases.

## 3. Product Requirements Document

### 3.1 Goals

- Publish curated albums of 3DGS scenes to the web.
- Allow protected viewing by invited users through OAuth-style authentication.
- Support PlayCanvas/WebXR viewing with Meta Quest-class headset compatibility.
- Keep upload/delete/album management simple enough for one curator.
- Keep baseline monthly cost near zero for small/private usage.

### 3.2 Non-Goals for MVP

- No public user-generated uploads.
- No cloud-side reconstruction or SHARP execution.
- No paid marketplace, comments, likes, social graph, or public account system.
- No heavy database requirement unless album permissions or analytics become necessary.
- No attempt to make R2 the production source of truth; the local curator/export folder remains authoritative.

### 3.3 User Stories

| ID | User Story | Priority |
|---|---|---|
| US-01 | As a curator, I can export selected local albums into a web-ready publish folder. | P0 |
| US-02 | As a curator, I can sync the publish folder to cloud storage and update the website without manual file-by-file uploads. | P0 |
| US-03 | As a viewer, I can authenticate and view only the galleries I am allowed to access. | P0 |
| US-04 | As a viewer, I can browse albums, see thumbnails, and open a selected 3DGS scene. | P0 |
| US-05 | As a viewer, I can enter WebXR/VR mode on a compatible headset. | P1 |
| US-06 | As a curator, I can archive/unpublish a scene without immediately deleting its underlying asset files. | P1 |
| US-07 | As a curator, I can later use a browser admin UI to upload, reorder, delete, and edit metadata. | P2 |

### 3.4 Functional Requirements

| Area | Requirement | Priority |
|---|---|---|
| Album index | The site shall load a top-level index.json containing published albums. | P0 |
| Album manifest | Each album shall have an album.json with title, cover, scene list, status, and sort order. | P0 |
| Scene metadata | Each scene shall have scene metadata with ID, title, thumbnail, SOG path, splat count, status, and optional notes. | P0 |
| Viewer | The viewer shall load PlayCanvas-compatible 3DGS/SOG assets from R2-backed URLs. | P0 |
| Authentication | The deployed site and protected assets shall be gated behind Cloudflare Access or equivalent OAuth gate. | P0 |
| Publishing | The curator shall be able to publish by syncing an exported folder to R2. | P0 |
| Delete/unpublish | The system shall support unpublish/archive status before physical deletion. | P1 |
| Thumbnails | Each album and scene should support static thumbnail/cover images. | P1 |
| Future admin | The architecture shall allow adding a Worker-based admin API later without changing asset layout. | P2 |

### 3.5 Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Initial page UI should load quickly. Scene load time depends on SOG size and client bandwidth; target optimized scene delivery files rather than archival PLY. |
| Compatibility | Viewer should target modern Chromium-based browsers and Quest browser/WebXR where supported. Desktop fallback should remain usable. |
| Security | Private galleries should not expose assets on an unprotected public R2 domain. Viewer route and asset route should share the same access policy where practical. |
| Reliability | Publishing should be repeatable and recoverable from local source-of-truth folders. Use dry-run sync before destructive sync. |
| Maintainability | Use simple folder conventions, immutable scene IDs, and JSON manifests to avoid database migration overhead. |
| Cost control | Avoid per-byte egress charges; prefer R2/Cloudflare edge delivery and keep object count per scene understood. |

## 4. Proposed Architecture

### 4.1 MVP Architecture

```text
Local curator app / export script
  - SHARP/3DGS outputs
  - rating + album selection
  - converts/validates SOG
  - writes album manifests
        |
        | rclone sync / Cyberduck upload
        v
Cloudflare R2 bucket
  /albums/index.json
  /albums/<album-slug>/album.json
  /albums/<album-slug>/cover.jpg
  /albums/<album-slug>/scenes/<scene-id>/sog/*
        ^
        |
Cloudflare Pages viewer + PlayCanvas/WebXR
        |
Cloudflare Access protects viewer + asset paths
```

### 4.2 Recommended Folder Convention

```text
vr-gallery-publish/
  albums/
    index.json
    tokyo-gallery/
      album.json
      cover.jpg
      scenes/
        2026-05-room-a-v001/
          scene.json
          thumb.jpg
          sog/
            meta.json
            means_l.webp
            means_u.webp
            scales.webp
            quats.webp
            sh0.webp
            ...
```

### 4.3 Manifest Example

```json
{
  "id": "tokyo-gallery",
  "title": "Tokyo Gallery",
  "visibility": "private",
  "cover": "/albums/tokyo-gallery/cover.jpg",
  "scenes": [
    {
      "id": "2026-05-room-a-v001",
      "title": "Room A",
      "status": "published",
      "thumbnail": "/albums/tokyo-gallery/scenes/2026-05-room-a-v001/thumb.jpg",
      "sog": "/albums/tokyo-gallery/scenes/2026-05-room-a-v001/sog/meta.json",
      "splatCount": 1600000,
      "sortOrder": 1
    }
  ]
}
```

### 4.4 Publishing Workflow

1. Curator selects scenes/albums in the existing local tool.
2. Export process converts or verifies PlayCanvas-compatible delivery assets, ideally SOG.
3. Export process writes index.json, album.json, scene.json, thumbnails, and cover images.
4. Curator runs rclone sync with `--dry-run` to preview changes.
5. Curator runs real sync to R2.
6. Cloudflare Pages viewer loads the updated manifests and assets.

```bash
# Preview destructive changes first
rclone sync ./vr-gallery-publish r2:vr-gallery-prod --progress --dry-run

# Publish when dry-run looks correct
rclone sync ./vr-gallery-publish r2:vr-gallery-prod --progress
```

## 5. Upload and Management Options

| Option | Description | Best For | Tradeoff |
|---|---|---|---|
| A. R2 dashboard / Cyberduck | Manual S3-compatible object browser upload/delete. | Occasional manual changes and inspection. | Easy to make inconsistent folder or manifest edits. |
| B. rclone sync | Local publish folder mirrors to R2. | Primary MVP workflow; single curator. | Requires disciplined local source-of-truth and dry-run habit. |
| C. Custom admin UI | Browser UI backed by Worker API and R2/D1. | Multi-curator or nontechnical management. | More engineering; upload complexity for large scene folders. |

### 5.1 MVP Management Choice

Use rclone sync as the primary management mechanism. Use Cyberduck only for inspection or emergency manual correction. Do not build a custom admin app until the workflow proves that browser-based management is actually required.

### 5.2 Future Admin API

```text
GET    /api/albums
POST   /api/albums
PUT    /api/albums/:albumId
DELETE /api/albums/:albumId
POST   /api/albums/:albumId/scenes
PUT    /api/albums/:albumId/scenes/:sceneId
DELETE /api/albums/:albumId/scenes/:sceneId
POST   /api/upload-url
POST   /api/publish
```

For large assets, future admin uploads should use browser-to-R2 direct upload URLs rather than routing all payload bytes through the Worker. The Worker should validate identity, create upload authorization, update metadata, and perform lifecycle operations.

## 6. Security and Access Control

- Protect both the viewer and asset paths. Do not gate only the HTML while leaving R2 assets public under predictable URLs.
- Use Cloudflare Access/OAuth for MVP instead of custom login code.
- Use separate R2 credentials for publishing. The upload token should be limited to the specific bucket or prefix where possible.
- Avoid embedding write credentials in the frontend. Browser clients should never receive permanent R2 write keys.
- For stronger future security, use short-lived signed URLs or Worker-mediated asset reads.

## 7. Cost Model

The cost model is favorable because the proposed architecture stores large assets in R2 and serves them without traditional egress charges. Costs primarily come from storage and object operations. Actual cost depends on compressed scene size, number of scenes, object count per scene, and scene-load frequency.

| Scenario | Assumption | Likely Monthly Cost |
|---|---|---|
| Small private gallery | 10-100 SOG scenes, light private traffic, under R2 free tier. | $0-$2 |
| Moderate curated gallery | 100-300 SOG scenes, moderate traffic, still mostly within free tier or low overage. | $0-$5 |
| Custom admin added | Worker API and optional D1 metadata. | $0-$5+ depending on Workers plan and request volume |
| Larger public gallery | Hundreds of scenes and heavier traffic. | Still likely low; monitor R2 Class B operations and storage. |

### 7.1 Sizing Assumptions

| Asset Type | Rough Size Per 1.6M-Splat Scene | 10 GB Stores Approx. |
|---|---|---|
| Raw/high precision PLY | 150-500 MB | 20-65 scenes |
| Optimized/compressed PLY | 50-150 MB | 65-200 scenes |
| PlayCanvas SOG | 10-50 MB | 200-1,000 scenes |

These are planning estimates, not guarantees. The real size depends on spherical harmonics, quantization, pruning, texture/image encoding, and output format.

## 8. Implementation Roadmap

| Phase | Scope | Exit Criteria |
|---|---|---|
| Phase 0 - Validation | Pick 3-5 representative scenes. Convert to SOG. Upload manually. Confirm PlayCanvas viewer loads them on desktop and Quest browser. | Known scene-size range, confirmed viewer compatibility, rough load-time baseline. |
| Phase 1 - Static MVP | Build Cloudflare Pages viewer, R2 folder layout, JSON manifests, Access protection, rclone publish flow. | Private URL shows album grid and loads published scenes. |
| Phase 2 - Local publishing tool | Add export script/button from local curator app. Generate manifests, thumbnails, status flags, and dry-run sync command. | Curator can publish/update/delete using local source-of-truth folder. |
| Phase 3 - Hardening | Add archive workflow, orphan detection, manifest validation, cache headers, basic logging, and backup strategy. | Safe repeatable publishing with low accidental-delete risk. |
| Phase 4 - Optional CMS | Add Worker admin API, browser upload, album edit UI, D1 metadata, per-album permissions if required. | Nontechnical or multi-curator management becomes possible. |

## 9. MVP Acceptance Criteria

- A viewer can authenticate and access the gallery URL.
- The album index loads from R2-hosted JSON metadata.
- At least one album displays cover art, scene thumbnails, and scene titles.
- A selected 1.6M-splat scene loads successfully in the PlayCanvas viewer.
- The same asset layout supports at least five published scenes without code changes.
- A curator can unpublish a scene by changing metadata status and syncing.
- The R2 bucket is not used as the only source of truth; local export remains recoverable.
- The system avoids custom database/auth code in MVP unless a blocking requirement emerges.

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quest/browser memory limits | Large scenes may fail or stutter in VR. | Use SOG, prune/LOD variants, test target headsets early. |
| Asset URL leakage | Private scenes may be exposed if R2 public URLs are shared. | Protect viewer and assets under Access, or move to signed URLs later. |
| Accidental destructive sync | rclone sync can delete remote assets if local folder is wrong. | Always dry-run; use archive status; add orphan cleanup script instead of immediate deletion. |
| Manifest drift | Manual uploads can create inconsistent metadata. | Make local exporter authoritative and validate JSON before sync. |
| Overbuilding admin tools | Time spent on CMS instead of viewer quality. | Start with local export + sync; add admin only when management pain is proven. |
| Cost surprise from object operations | Many small files per scene create more reads. | Track R2 Class B operations; cache static assets; consider bundled SOG where supported. |

## 11. Open Questions

- What is the actual SOG size range for representative 1.6M-splat scenes from the SHARP pipeline?
- Does the target Quest browser handle the intended scene count, memory footprint, and frame rate?
- Should albums be private to all authenticated users or restricted per invited viewer?
- Will the public viewer need progressive loading, LOD, or scene variants?
- Is the local curator app able to export thumbnails and metadata reliably, or is a separate exporter needed?

## 12. Final Recommendation

Build the static publishing MVP first: local export folder, rclone sync, R2 storage, Pages viewer, Cloudflare Access. This gives the product its core value - secure viewing of curated 3DGS VR albums - without creating a second ingest system or unnecessary cloud CMS. Only add a Worker/D1 admin layer after the manual/sync workflow becomes the bottleneck.

## 13. References

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 product overview: https://www.cloudflare.com/products/r2/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- PlayCanvas SOG format documentation: https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/
- Cloudflare Access product page: https://www.cloudflare.com/en-ca/sase/products/access/
- Cloudflare R2 rclone examples: https://developers.cloudflare.com/r2/examples/rclone/
- Cyberduck Cloudflare R2 profile docs: https://docs.cyberduck.io/protocols/s3/cloudflare/
