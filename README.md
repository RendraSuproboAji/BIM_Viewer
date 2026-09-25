# BIM_Viewer

An experimental web BIM viewer for IFC models, built with
[React Three Fiber](https://github.com/pmndrs/react-three-fiber) and
[That Open Engine](https://github.com/ThatOpen/engine_components).

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
  - **Login, users and projects**: the first run creates an admin. Admins manage users. Each project has members with the role owner, editor or viewer.
  - **Model library**: 💾 saves a loaded model as `.frag` and reopens it instantly later, without re-converting the IFC
  - **Extracted BIM data**: every element's GUID, class, name, storey, and property/quantity sets become searchable records, exportable to CSV per model
  - **Saved views**: camera, section plane, hidden classes, X-ray, and which library models are open
  - **Issues**: each issue has a title, status, priority, assignee, due date, linked elements, a **viewpoint** (camera + section + snapshot) and comments. Opening an issue restores its viewpoint.
  - **BCF 2.1 import/export** (`.bcfzip`), for round trips with Revit, Solibri, BIMcollab, etc. The importer also reads BCF 3.0. Re-importing the same file updates the issues rather than duplicating them.

## Stack: which repo does what

| Repository | Role |
| --- | --- |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | Owns the renderer, scene, camera, and render loop as React components |
| [pmndrs/drei](https://github.com/pmndrs/drei) | `CameraControls`, `Grid`, `GizmoHelper` helpers for R3F |
| [ThatOpen/engine_components](https://github.com/ThatOpen/engine_components) | `IfcLoader` (IFC → Fragments) and `FragmentsManager` |
| [ThatOpen/engine_fragments](https://github.com/ThatOpen/engine_fragments) | Worker-based geometry streaming/LOD, raycasting, highlight, visibility, and BIM data queries |
| [ThatOpen/engine_web-ifc](https://github.com/ThatOpen/engine_web-ifc) | WASM IFC parser used by the IFC importer |
| [yomotsu/camera-controls](https://github.com/yomotsu/camera-controls) | Camera controls engine behind drei's `CameraControls` |
| [pmndrs/zustand](https://github.com/pmndrs/zustand) | App state (models, selection, section, loading) |
| [fastify/fastify](https://github.com/fastify/fastify) | API server (`server/`) |
| [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite database |

The key design choice is that **R3F owns rendering and That Open owns BIM data**.
We don't use That Open's `World`/`SimpleRenderer`. Each loaded `FragmentsModel.object`
is added to the R3F scene and bound to the R3F camera (`model.useCamera`), and
`fragments.core.update()` runs whenever the camera moves or comes to rest.

## IFC class coverage

That Open's IFC importer only converts a curated list of classes by default. That list silently drops, for example,
`IfcDistributionBoard`, `IfcLiquidTerminal`, `IfcElectricFlowTreatmentDevice`, `IfcSpatialZone`, `IfcVibrationDamper`,
the IFC2x3 MEP classes `IfcElectricalElement`, `IfcEquipmentElement` and `IfcElectricDistributionPoint`, every property
kind except `IfcPropertySingleValue`, MEP systems, and classification references.

`src/bim/ifc-classes.ts` builds the full list from web-ifc's own schema inheritance tables, so nothing is hand-maintained:

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
npm run build      # production build in dist/
npm start          # one Node process serving dist/ and the API on http://localhost:3001
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on Node 22 and 24 for every pull request and every push to `main`.

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
- Every project route checks membership: non-members get 404 and viewers are read-only.
- Serve the app over HTTPS (for example behind a reverse proxy) when exposing it beyond localhost.

### Database schema

Defined as versioned migrations in `server/src/db.ts` (`PRAGMA user_version`), applied automatically at startup:

| Table | Contents |
| --- | --- |
| `users`, `sessions` | Accounts (admin / member) and login sessions |
| `projects`, `project_members` | Projects and per-project roles |
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
| `GET` / `POST` | `/api/users` | List / create users (admin) |
| `PATCH` / `DELETE` | `/api/users/:id` | Update / delete a user (admin) |
| `GET` / `POST` | `/api/projects` | List own projects / create |
| `PATCH` / `DELETE` | `/api/projects/:id` | Rename / delete (owner) |
| `GET` / `PUT` | `/api/projects/:id/members` | List / add or change a member (owner) |
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

## Project layout

```
shared/                api types and CSV helpers shared by the web app and the server
server/
  src/db.ts            SQLite connection + schema migrations
  src/auth.ts          passwords, sessions, throttling, project roles
  src/bcf.ts           BCF 2.1 writer / BCF 2.1+3.0 reader
  src/app.ts           Fastify app; routes in src/routes/
  src/index.ts         server entry (also serves dist/ in production)
  test/                API, auth and migration tests (node:test)
src/
  api/client.ts        typed API client
  bim/engine.ts        That Open setup (FragmentsManager, worker IFC import), picking, snapping, clipping
  bim/ifc-worker.ts    IFC → Fragments conversion in a Web Worker
  bim/ifc-classes.ts   full IFC class catalogue, disciplines, extra relations
  bim/actions.ts       load / select / isolate / hide / x-ray / export
  bim/store.ts         zustand store
  bim/session.ts       sign-in state, projects
  bim/library.ts       model library, BIM data extraction, saved views
  bim/issues.ts, viewpoint.ts   issues and BCF viewpoints (camera, clipping, snapshot)
  bim/measure.ts       measurement maths
  bim/takeoff.ts, colorby.ts    quantity takeoff and colour-by-property
  bim/clash.ts, clash-run.ts    clash detection
  bim/compare.ts, compare-run.ts  model version comparison
  bim/*.test.ts        unit tests
  components/          Viewport (R3F canvas), Toolbar, ModelTree, Categories, Properties,
                       DataPanel, ClashPanel, ComparePanel, Library, Issues, Measurements,
                       Auth, ProjectMenu
scripts/copy-wasm.mjs  copies web-ifc WASM to public/web-ifc (runs automatically)
```

## Notes

- **`web-ifc` is pinned to `0.0.77`**, the version `@thatopen/components` / `@thatopen/fragments` 3.4.x
  are built against. `0.0.78` fails during IFC conversion with
  `StreamMeshes called with 4 arguments, expected 3`. Only upgrade it together with the ThatOpen packages.
- The web-ifc WASM and the fragments worker are served locally, so the viewer doesn't depend on unpkg at runtime.
- Converting large IFC files in the browser can take a while. Export the result to `.frag` for fast reloads.
