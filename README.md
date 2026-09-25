# BIM_Viewer

An experimental web BIM viewer for IFC models, built with
[React Three Fiber](https://github.com/pmndrs/react-three-fiber) and
[That Open Engine](https://github.com/ThatOpen/engine_components).

## Features

- Open **IFC** (converted in the browser) or **.frag** (That Open Fragments) files: file picker, drag & drop, or the built-in sample
- Multiple models side by side, with per-model show/hide, remove, and **export to .frag**, which reloads much faster than IFC
- **Spatial tree** (Project → Site → Building → Storey → elements) with per-node visibility and click-to-select/zoom
- **IFC classes** panel with element counts and per-class visibility
- Click-to-pick in 3D with highlight, plus a **properties panel** showing attributes, property sets, quantity sets, material, and container
- Isolate / hide / show all, zoom to selection, fit all, **X-ray** (ghost) mode
- **Section plane** on X / Y / Z with a position slider and flip
- Orbit/pan/zoom camera, infinite grid, and an axis gizmo

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

The key design choice is that **R3F owns rendering and That Open owns BIM data**.
We don't use That Open's `World`/`SimpleRenderer`. Each loaded `FragmentsModel.object`
is added to the R3F scene and bound to the R3F camera (`model.useCamera`), and
`fragments.core.update()` runs whenever the camera moves or comes to rest.

## Getting started

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build
```

Click **Load sample** to open ThatOpen's `school_str.ifc` (downloaded from GitHub),
or open/drop your own `.ifc` / `.frag` file.

## Project layout

```
src/
  bim/engine.ts        That Open setup (FragmentsManager, IfcLoader) + picking
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
