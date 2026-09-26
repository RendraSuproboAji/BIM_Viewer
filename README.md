# BIM_Viewer

An experimental web BIM viewer for IFC models, built with
[React Three Fiber](https://github.com/pmndrs/react-three-fiber) and
[That Open Engine](https://github.com/ThatOpen/engine_fragments).

## Features

- Open **IFC** (converted in the browser) or **.frag** (That Open Fragments) files: file picker, drag & drop, or the built-in sample
- Multiple models side by side, with per-model show/hide, remove, and **export to .frag**, which reloads much faster than IFC
- **Spatial tree** (Project → Site → Building → Storey → elements) with per-node visibility and click-to-select/zoom
- **Every IFC class** in IFC2x3, IFC4 and IFC4.3 is imported: architecture, structure, MEP, spaces/zones, openings and infrastructure (see below)
- **IFC classes** panel grouped by discipline (Architecture / Structure / MEP / Spaces & zones / Openings / Infrastructure) with element counts and per-class or per-discipline visibility. Spaces, zones and openings start hidden.
- Click-to-pick in 3D with highlight, plus a **properties panel** showing attributes, type, property sets (single, enumerated, bounded, list, table, reference and complex properties), quantity sets, materials, classifications, **MEP systems**, openings/fillings, container, and parts
- Isolate / hide / show all, zoom to selection, fit all, **X-ray** (ghost) mode
- **Section plane** on X / Y / Z with a position slider and flip
- Orbit/pan/zoom camera, infinite grid, and an axis gizmo
- **Measurements**: distance, area and angle, snapping to vertices, edges and faces. They stay in the scene and can be listed and deleted.
- **Quantity takeoff**: counts and sums of any numeric property or quantity, grouped by class, storey, type or any property. Also gives the geometric volume computed from the 3D shapes, so it works without Qto sets. Exports to CSV.
- **Colour by property** with a legend. Numeric values can be grouped into ranges. Each legend entry can be selected or hidden.
- **Clash detection**: architecture/structure against MEP, or any class set against another. Hard clashes (with a depth tolerance) or clearance checks. A sort-and-sweep broad phase narrows candidates, then exact BVH mesh tests run ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)). Each clash can be focused and turned into an issue.
- **Model version comparison**: matches two versions by GlobalId and reports added, removed and changed elements (properties, position and size, with a 1 mm tolerance). Changes are colour-coded in 3D, shown as a per-element diff, and exportable to CSV.
- **IFC conversion runs in a Web Worker**, so the UI stays responsive while large files load.
- **Server & database (SQLite, via the API server)**:
  - **Login, users, projects and roles** (RBAC): the first run creates an admin. Every account is an **Admin**, **Editor** or **Client** (see [Roles](#roles)); project membership decides which projects a user sees.
  - **Model library**: 💾 saves a loaded model as `.frag` and reopens it instantly later, without re-converting the IFC
  - **Extracted BIM data**: every element's GUID, class, name, storey, and property/quantity sets become searchable records, exportable to CSV per model
  - **Saved views**: camera, section plane, hidden classes, X-ray, and which library models are open
  - **Issues**: each issue has a title, status, priority, assignee, due date, linked elements, a **viewpoint** (camera + section + snapshot) and comments. Opening an issue restores its viewpoint.
  - **BCF 2.1 import/export** (`.bcfzip`), for round trips with Revit, Solibri, BIMcollab, etc. The importer also reads BCF 3.0. Re-importing the same file updates the issues rather than duplicating them.
- **VR, AR and MR** (WebXR, via [pmndrs/xr](https://github.com/pmndrs/xr)): walk through the model at 1:1 in VR, place it on a table or the floor in MR (Quest 3 passthrough), or in the camera view of a phone in AR. The **XR** menu checks the device first and shows each mode as ready, limited or unavailable, with the reason. See [VR, AR and MR](#vr-ar-and-mr).

## Stack: which repo does what

| Repository | Role |
| --- | --- |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | Owns the renderer, scene, camera, and render loop as React components |
| [pmndrs/drei](https://github.com/pmndrs/drei) | `CameraControls`, `Grid`, `GizmoHelper` helpers for R3F |
| [ThatOpen/engine_fragments](https://github.com/ThatOpen/engine_fragments) | `IfcImporter` (IFC → Fragments, in a worker), and `FragmentsModels`: worker-based geometry streaming/LOD, raycasting, highlight, visibility, and BIM data queries |
| [ThatOpen/engine_web-ifc](https://github.com/ThatOpen/engine_web-ifc) | WASM IFC parser used by the IFC importer |
| [yomotsu/camera-controls](https://github.com/yomotsu/camera-controls) | Camera controls engine behind drei's `CameraControls` |
| [pmndrs/zustand](https://github.com/pmndrs/zustand) | App state (models, selection, section, loading) |
| [fastify/fastify](https://github.com/fastify/fastify) | API server (`server/`) |
| [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite database |
| [pmndrs/xr](https://github.com/pmndrs/xr) | WebXR sessions, controllers/hands, locomotion, DOM overlay; IWER emulator in development |
| [pmndrs/uikit](https://github.com/pmndrs/uikit) | The in-headset menu and property panel |

The key design choice is that **R3F owns rendering and That Open owns BIM data**.
We don't use That Open's `World`/`SimpleRenderer`. Each loaded `FragmentsModel.object`
is added to the R3F scene and bound to the R3F camera (`model.useCamera`), and
`fragments.core.update()` runs whenever the camera moves or comes to rest.

## IFC class coverage

That Open's IFC importer only converts a curated list of classes by default. That list silently drops, for example,
`IfcDistributionBoard`, `IfcLiquidTerminal`, `IfcElectricFlowTreatmentDevice`, `IfcSpatialZone`, `IfcVibrationDamper`,
the IFC2x3 MEP classes `IfcElectricalElement`, `IfcEquipmentElement` and `IfcElectricDistributionPoint`, every property
kind except `IfcPropertySingleValue`, MEP systems, and classification references.

`src/bim/ifc-schema.ts` builds the full list from web-ifc's own schema inheritance tables, so nothing is hand-maintained
(it runs in the conversion worker; the viewer gets the discipline tables pre-generated, see [Performance](#performance)):

- **Geometry:** every `IfcProduct` subtype in all three schemas (207 classes). The only exclusions are alignments,
  which That Open processes separately, and structural-analysis items (loads, reactions, idealised members), which are analytical rather than physical.
- **Data:** every `IfcTypeObject` (incl. IFC2x3 `IfcDoorStyle`/`IfcWindowStyle`), `IfcProperty`, `IfcPropertySetDefinition`,
  `IfcPhysicalQuantity`, `IfcGroup` (systems, circuits, zones) and classification subtype.
- **Relations:** systems (`IfcRelAssignsToGroup`, `IfcRelServicesBuildings`), ports and flow controls (MEP),
  voids/fills/projections/coverings/space boundaries (architecture), and classifications, on top of That Open's defaults.

It was verified against buildingSMART's
[Sample-Test-Files](https://github.com/buildingSMART/Sample-Test-Files) "Simple-Scene" models (Architecture, HVAC,
Structural, Electrical, Plumbing in IFC2x3, IFC4 and IFC4.3), plus variants using the classes and property kinds above.

## Getting started

Requires Node 22+.

```bash
npm install
npm run dev        # web app on http://localhost:5173 + API on :3001 (Vite proxies /api)
npm test           # API + unit tests
npm run e2e        # browser end-to-end suites (see e2e/README.md)
npm run build      # production build in dist/
npm start          # one Node process serving dist/ and the API on http://localhost:3001
```

**Production:** `docker compose up -d --build` runs the app behind **nginx**, which serves the precompressed, long-cached static files. A small Node container serves only the API. See [deploy/README.md](deploy/README.md).

**CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`. It has three jobs:
- typecheck, lint (warnings fail too), unit/API tests and build, on Node 22 and 24;
- the browser end-to-end suites;
- a Docker build of both images plus an nginx smoke test.

`npm run dev:web` / `npm run dev:api` start each half on its own. The viewer also works without the API: choose
"Use the viewer without the server" on the sign-in screen. Library, saved views and issues need the server.

On first start, the sign-in screen asks you to create the administrator account.

### Server configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3001` | API / app port |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to accept remote connections |
| `DATA_DIR` | `server/data` | Holds `bim.sqlite` and uploaded `models/*.frag` (gitignored) |
| `MAX_UPLOAD_MB` | `500` | Largest `.frag` / `.bcfzip` upload |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so login throttling sees client IPs |

**Security:**
- Passwords are hashed with scrypt.
- Sessions use an httpOnly, `SameSite=Strict` cookie; only its SHA-256 hash is stored.
- Repeated failed logins are throttled.
- Every project route checks membership (non-members get 404) and the user's role (403); see [Roles](#roles).
- Serve the app over HTTPS (for example behind a reverse proxy) when exposing it beyond localhost.

### Roles

Each account has one role; project membership decides which projects a user sees (admins see all). The rules live in [`shared/permissions.ts`](shared/permissions.ts), which the API enforces and the UI uses to show or hide actions.

| | Admin | Editor | Client |
| --- | :---: | :---: | :---: |
| See projects | all | member of | member of |
| Open models, saved views, properties; measure, takeoff, clash, compare (local) | ✓ | ✓ | ✓ |
| Export CSV / BCF | ✓ | ✓ | ✓ |
| Raise issues, comment | ✓ | ✓ | ✓ |
| Edit their own issues (title, description, labels, elements, viewpoint) | ✓ | ✓ | ✓ |
| Triage issues (status, priority, assignee, due date), edit or delete any issue | ✓ | ✓ | |
| Delete other people's comments | ✓ | ✓ | |
| Upload / delete library models, save views, import BCF | ✓ | ✓ | |
| Manage users, projects and members | ✓ | | |

- New accounts are clients by default and see no projects until an admin adds them (the "Add user" form can add them to a project straight away).
- Role changes apply on the user's next request; there is always at least one admin.
- Non-admins only see the people they share a project with.
- Upgrading from the earlier per-project roles: admins stay admins; members who owned or edited any project become editors; members who were only ever viewers become clients.

### Database schema

Defined as versioned migrations in `server/src/db.ts` (`PRAGMA user_version`), applied automatically at startup:

| Table | Contents |
| --- | --- |
| `users`, `sessions` | Accounts with their role (admin / editor / client) and login sessions |
| `projects`, `project_members` | Projects and who can see them |
| `models` | Library entries per project. The `.frag` bytes live in `DATA_DIR/models/<id>.frag`. |
| `elements` | One row per element with geometry: GUID, class, name, storey, properties (JSON) |
| `views` | Named viewer states (JSON) |
| `issues`, `issue_components`, `issue_comments` | Issues with viewpoint and snapshot, linked element GUIDs, comments |

Deleting a project cascades to everything in it. Deleting a model cascades to its elements.

### API

Every route except `/api/health`, `/api/auth/status`, `/setup`, `/login` and `/logout` requires a session.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/auth/status` | Current user and whether setup is needed |
| `POST` | `/api/auth/setup` · `/login` · `/logout` · `/password` | First admin, sign in/out, change password |
| `GET` / `POST` | `/api/users` | List users (admins: all; others: people they share a project with) / create (admin) |
| `PATCH` / `DELETE` | `/api/users/:id` | Update / delete a user (admin) |
| `GET` / `POST` | `/api/projects` | List visible projects / create (admin) |
| `PATCH` / `DELETE` | `/api/projects/:id` | Rename / delete (admin) |
| `GET` / `PUT` | `/api/projects/:id/members` | List / add a member (admin) |
| `DELETE` | `/api/projects/:id/members/:userId` | Remove a member |
| `GET` / `POST` | `/api/models?projectId=` | List / upload (`application/octet-stream`, `?name=`) |
| `GET` / `DELETE` | `/api/models/:id` | Get / delete |
| `GET` | `/api/models/:id/file` | Download `.frag` |
| `PUT` | `/api/models/:id/elements` | Replace extracted element data |
| `GET` | `/api/models/:id/elements.csv` | CSV export |
| `GET` | `/api/elements?projectId=&q=&category=&modelId=&limit=&offset=` | Search elements |
| `GET` | `/api/elements/categories?projectId=` | Element counts per class |
| `GET` / `POST` | `/api/views` | List / create saved views |
| `PUT` / `DELETE` | `/api/views/:id` | Update / delete |
| `GET` / `POST` | `/api/issues?projectId=&status=&guid=&modelId=&assigneeId=` | List / create issues |
| `GET` / `PATCH` / `DELETE` | `/api/issues/:id` | Get (with comments) / update / delete |
| `GET` | `/api/issues/:id/snapshot.png` | Viewpoint snapshot |
| `POST` | `/api/issues/:id/comments` | Add a comment |
| `DELETE` | `/api/comments/:id` | Delete a comment |
| `GET` | `/api/projects/:id/bcf?ids=` | Export issues as BCF 2.1 `.bcfzip` |
| `POST` | `/api/projects/:id/bcf` | Import a `.bcfzip` (BCF 2.1 / 3.0) |

Click **Load sample** to open ThatOpen's `school_str.ifc` (downloaded from GitHub),
or open/drop your own `.ifc` / `.frag` file.

## VR, AR and MR

Open a model, then click **XR ▾** in the toolbar. The menu checks the connected device before you choose:

1. **HTTPS**: WebXR only works in a secure context (or on `localhost`).
2. **WebXR** in the browser, then `immersive-vr` and `immersive-ar` support.
3. **Headset or handheld**, from the browser (Meta Quest Browser, Pico, Vision Pro, Android). After a session starts, `session.interactionMode` confirms it.

Each mode is shown as **✓ ready**, **⚠ limited** or **✗ unavailable**, with the reason. **Show compatibility details** lists what the browser reported, plus the table below. The XR code (about 800 kB, 400 kB gzipped, including the menu font) only loads when the menu is opened; the initial download is unchanged.

| Mode | What it is | Scale | Controls |
| --- | --- | --- | --- |
| **VR** | Fully virtual walkthrough | 1:1, or a 1:50 / 1:100 / 1:200 overview | Trigger: select (or measure); grip on a floor: teleport; left stick: move; right stick: snap turn |
| **MR** | Headset passthrough; the model sits in your room | Starts at 1:100 on a table; 1:1 on the floor | Aim at a surface and pull the trigger (or pinch) to place; then trigger/pinch selects. The placement is anchored where the headset supports anchors |
| **AR** | Phone/tablet camera view | Starts at 1:100 | Tap a surface to place, tap an element to select; the HTML bar and Properties panel stay on screen (DOM overlay) |

In VR and MR a floating menu follows you: scale, start/re-place, section (axis, position, flip), X-ray, discipline toggles, distance measuring, and the selected element's properties. Colour-by, clash and comparison colours, hidden classes and the section plane carry into every mode.

The user's origin is scaled and moved, never the model, so picking, snapping, clipping and BIM coordinates are exactly as on the desktop.

### Devices

| Device / browser | VR | AR | MR | Notes |
| --- | :-: | :-: | :-: | --- |
| **Meta Quest 3 / 3S** (Meta Quest Browser) | ✓ | – | ✓ | Primary target: colour passthrough, hands, planes, mesh, anchors, depth |
| Meta Quest Pro | ✓ | – | ✓ | Colour passthrough, no depth sensing |
| Meta Quest 2 | ✓ | – | ✓ | Greyscale passthrough |
| Pico 4 / 4 Ultra (Pico Browser) | ✓ | – | ✓ | Partial plane/anchor support |
| Apple Vision Pro (Safari) | ✓ | – | – | Safari has no `immersive-ar` |
| Android phone with ARCore (Chrome) | – | ✓ | – | Hit-test and DOM overlay |
| iPhone / iPad (Safari) | – | – | – | No WebXR |
| PC VR (SteamVR/OpenXR: Quest Link, Index, Vive) in Chrome/Edge | ✓ | – | – | |

The menu decides from what the browser actually reports; this table is what to expect.

### Trying it

- **Headset or phone on the LAN:** `npm run dev:xr` serves the dev build over HTTPS (self-signed certificate; accept the warning once) on all interfaces. Open `https://<your-pc-ip>:5173` on the device.
- **Quest over USB:** `adb reverse tcp:5173 tcp:5173`, then `npm run dev` and open `http://localhost:5173` in the Quest browser (`localhost` counts as secure).
- **No headset:** in `npm run dev` the menu uses the [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) Quest 3 emulator, with its on-screen controls. Production builds never include the emulator.
- **Production:** serve over HTTPS (see `deploy/`).

Controller models and hand meshes are loaded from the jsDelivr CDN. On an air-gapped site, host a copy of `@webxr-input-profiles/assets` and build with `VITE_XR_ASSETS=https://your-host/path/`. Without it, selecting and teleporting still work; only the controller models are missing.

## Performance

The viewer is built to load fast and stay light:

- **First load ≈ 640 kB of gzipped JavaScript**. Everything else loads when it is first used:
  - the IFC converter (web-ifc and its WASM), only when an `.ifc` file is opened;
  - the Data, Clash and Library tabs (clash detection's BVH library included);
  - the XR modes.
- **web-ifc stays off the main thread.** Its multi-MB schema tables are only needed by the conversion worker. The IFC
  discipline tables the viewer needs are generated from them into a 5 kB module (`npm run gen:ifc-classes`).
- **Libraries in their own chunks** (React, three.js, fragments), cached for a year: an app update only re-downloads
  the app code.
- **Only what's used ships:**
  - the minified fragments worker (1.4 MB instead of 3.3 MB);
  - the single-threaded web-ifc WASM (the multithreaded one needs cross-origin isolation, which the app doesn't use);
  - production builds leave out the ~5 MB WebXR emulator.

  `dist/` is 11 MB.
- **Rendering on demand**, at half resolution while the camera moves and full resolution once it settles.
- **Server:**
  - SQLite in WAL mode with `synchronous = NORMAL`;
  - nginx serves precompressed, immutable-cached assets;
  - the Node server does the same when it serves the app itself.

## Project layout

```
shared/                api types, CSV helpers and the role/permission matrix (permissions.ts), shared by web app and server
server/
  src/db.ts            SQLite connection + schema migrations
  src/auth.ts          passwords, sessions, throttling, project roles
  src/bcf.ts           BCF 2.1 writer / BCF 2.1+3.0 reader
  src/app.ts           Fastify app; routes in src/routes/
  src/index.ts         server entry (also serves dist/ in production)
  test/                API, auth and migration tests (node:test)
src/
  api/client.ts        typed API client
  bim/engine.ts        That Open setup (FragmentsModels, worker IFC import), picking, snapping, clipping
  bim/ifc-worker.ts    IFC → Fragments conversion in a Web Worker
  bim/ifc-schema.ts    full IFC class catalogue and extra relations from web-ifc (conversion worker)
  bim/ifc-classes.ts   disciplines for the viewer, from the generated ifc-disciplines.generated.ts
  bim/actions.ts       load / select / isolate / hide / x-ray / export
  bim/framing.ts       "Fit all" framing that ignores far-away markers
  bim/store.ts         zustand store
  bim/session.ts       sign-in state, projects
  bim/library.ts       model library, BIM data extraction, saved views
  bim/issues.ts, viewpoint.ts   issues and BCF viewpoints (camera, clipping, snapshot)
  bim/measure.ts       measurement maths
  bim/takeoff.ts, colorby.ts    quantity takeoff and colour-by-property
  bim/clash.ts, clash-run.ts    clash detection
  bim/compare.ts, compare-run.ts  model version comparison
  bim/*.test.ts        unit tests
  bim/ray.ts           picking along a 3D ray (controllers), via the screen-space picker
  xr/                  VR/AR/MR: capabilities (device check), XRMenu (mode picker), runtime (xr store),
                       XRLayer (session scene), origin/placement (scaling and placing the user),
                       SessionInput + actions (controller select/teleport/measure), XRPanel (in-headset UI),
                       ARControls (phone DOM overlay)
  components/          Viewport (R3F canvas), Toolbar, ModelTree, Categories, Properties,
                       DataPanel, ClashPanel, ComparePanel, Library, Issues, Measurements,
                       Auth, ProjectMenu
src/hooks/             useAsyncValue: keyed async loads without stale results
scripts/copy-wasm.mjs  copies web-ifc WASM to public/web-ifc (runs automatically)
e2e/                   browser end-to-end suites, fixtures and runner
deploy/                nginx config, deployment notes, smoke test (Dockerfile + compose.yaml at the root)
```

## Notes

- **The 3D view renders on demand** (R3F `frameloop="demand"`). It redraws only when the camera moves, geometry streams in, or something is selected, hidden or coloured. An idle viewer uses no GPU, which saves battery on laptops and tablets.

- **`web-ifc` is pinned to `0.0.77`**, the version `@thatopen/fragments` 3.4.x
  are built against. `0.0.78` fails during IFC conversion with
  `StreamMeshes called with 4 arguments, expected 3`. Only upgrade it together with the ThatOpen packages, then run
  `npm run gen:ifc-classes` (a unit test fails while the generated discipline tables are stale).
- The web-ifc WASM and the fragments worker are served locally, so the viewer doesn't depend on unpkg at runtime.
- Converting large IFC files in the browser can take a while. Export the result to `.frag` for fast reloads.
