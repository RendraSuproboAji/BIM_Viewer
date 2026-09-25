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
- **Database (SQLite, via the API server)**:
  - **Model library**: 💾 saves a loaded model as `.frag` and reopens it instantly later, without re-converting the IFC
  - **Extracted BIM data**: every element's GUID, class, name, storey, and property/quantity sets become searchable records, exportable to CSV per model
  - **Saved views**: camera, section plane, hidden classes, X-ray, and which library models are open
  - **Element notes / issues**: attached to an element's GUID, with status (open / in progress / resolved). The Issues tab lists them all and jumps back to the element.

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

Requires Node 20.19+.

```bash
npm install
npm run dev        # web app on http://localhost:5173 + API on :3001 (Vite proxies /api)
npm test           # API tests
npm run build      # production build in dist/
npm start          # one Node process serving dist/ and the API on http://localhost:3001
```

`npm run dev:web` / `npm run dev:api` start each half on its own. The viewer works without the API;
only the Library, Issues and Notes features need it.

### Server configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3001` | API / app port |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to accept remote connections |
| `DATA_DIR` | `server/data` | Holds `bim.sqlite` and uploaded `models/*.frag` (gitignored) |
| `MAX_UPLOAD_MB` | `500` | Largest `.frag` upload |

The API has **no authentication**. Keep it on localhost or put it behind an authenticating proxy before exposing it.

### Database schema

Defined as versioned migrations in `server/src/db.ts` (`PRAGMA user_version`), applied automatically at startup:

| Table | Contents |
| --- | --- |
| `models` | Library entries. The `.frag` bytes live in `DATA_DIR/models/<id>.frag`. |
| `elements` | One row per element with geometry: GUID, class, name, storey, properties (JSON) |
| `views` | Named viewer states (JSON) |
| `notes` | Notes/issues per element GUID, with status |

Deleting a model cascades to its elements and notes.

### API

| Method | Path | |
| --- | --- | --- |
| `GET` / `POST` | `/api/models` | List / upload (`application/octet-stream`, `?name=`) |
| `GET` / `DELETE` | `/api/models/:id` | Get / delete |
| `GET` | `/api/models/:id/file` | Download `.frag` |
| `PUT` | `/api/models/:id/elements` | Replace extracted element data |
| `GET` | `/api/models/:id/elements.csv` | CSV export |
| `GET` | `/api/elements?q=&category=&modelId=&limit=&offset=` | Search elements |
| `GET` | `/api/elements/categories` | Element counts per class |
| `GET` / `POST` | `/api/views` | List / create saved views |
| `PUT` / `DELETE` | `/api/views/:id` | Update / delete |
| `GET` / `POST` | `/api/notes?modelId=&guid=&status=` | List / create notes |
| `PATCH` / `DELETE` | `/api/notes/:id` | Update / delete |

Click **Load sample** to open ThatOpen's `school_str.ifc` (downloaded from GitHub),
or open/drop your own `.ifc` / `.frag` file.

## Project layout

```
shared/api.ts          types shared by the web app and the server
server/
  src/db.ts            SQLite connection + schema migrations
  src/app.ts           API routes (Fastify)
  src/index.ts         server entry (also serves dist/ in production)
  test/api.test.ts     API tests (node:test)
src/
  api/client.ts        typed API client
  bim/library.ts       save/open library models, BIM data extraction, saved views
  bim/properties.ts    IFC property parsing (shared by panel and extraction)
  components/Library.tsx, Notes.tsx, Issues.tsx
  bim/engine.ts        That Open setup (FragmentsManager, IfcLoader) + picking
  bim/ifc-classes.ts   full IFC class catalogue, disciplines, extra relations
  bim/actions.ts       load / select / isolate / hide / x-ray / export
  bim/store.ts         zustand store
  components/
    Viewport.tsx       R3F canvas; bridges fragments into the scene, section, picking
    ModelTree.tsx      spatial tree
    Categories.tsx     IFC class filter
    Properties.tsx     property sets / quantities
    Toolbar.tsx
scripts/copy-wasm.mjs  copies web-ifc WASM to public/web-ifc (runs automatically)
```

## Notes

- **`web-ifc` is pinned to `0.0.77`**, the version `@thatopen/components` / `@thatopen/fragments` 3.4.x
  are built against. `0.0.78` fails during IFC conversion with
  `StreamMeshes called with 4 arguments, expected 3`. Only upgrade it together with the ThatOpen packages.
- The web-ifc WASM and the fragments worker are served locally, so the viewer doesn't depend on unpkg at runtime.
- Converting large IFC files in the browser can take a while. Export the result to `.frag` for fast reloads.
