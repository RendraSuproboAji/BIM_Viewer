# Browser end-to-end tests

Nine suites drive the real app in headless Chromium with software WebGL, so no GPU is needed.

```bash
npm run e2e                 # all suites
npm run e2e -- clash issues # only some
```

The runner starts the Vite dev server on `:5174`, or reuses one that is already running. Set `E2E_URL` to test a server you start yourself. The dev server is used because it exposes the `window.__bim*` test hooks, which production builds leave out.

- **Viewer suites** (`interact`, `measure`, `stress`, `classes`, `data`, `clash`, `compare`) run in "viewer without the server" mode, so nothing may be listening on `:3001`.
- **API suites** (`db`, `issues`) start their own API server on `:3001` with a fresh data directory.

Screenshots, test data and `summary.json` go to `e2e/.output/`, which CI uploads as an artifact. Fixtures are in `e2e/fixtures/`; see `ATTRIBUTION.md` there. The one large model, ThatOpen's `school_str.ifc`, is downloaded on first use into `e2e/.cache/`.

| Suite | Covers |
| --- | --- |
| `interact` | Tree visibility, storeys, isolate/hide, X-ray, section |
| `measure` | Distance, area and angle with snapping; the list; deleting measurements |
| `stress` | Rapid selection, section vs gizmo, library save rollback (mocked API), WASM retry, a large model tree |
| `classes` | Every IFC class in the buildingSMART samples and the MEP variants shows up in the Classes panel |
| `data` | Colour by property, quantity takeoff, geometric volume |
| `clash` | Hard and clearance clashes, focus, clear |
| `compare` | Version comparison: added, changed and removed elements; the diff table; CSV |
| `db` | Model library, search, saved views, CSV, persistence across an API restart |
| `issues` | Login, projects and roles, issues with viewpoints, comments, BCF export/import, clash → issue |
