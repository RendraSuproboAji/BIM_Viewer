/// <reference lib="webworker" />
// Converts IFC to Fragments off the main thread, so the page stays responsive
// (web-ifc parsing and geometry generation can take minutes on big models).
import * as FRAGS from "@thatopen/fragments";
import { includeEverything, type IfcWorkerRequest, type IfcWorkerResponse } from "./ifc-import";

const post = (message: IfcWorkerResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<IfcWorkerRequest>) => {
  const { bytes, wasmPath } = event.data;
  try {
    const importer = new FRAGS.IfcImporter();
    importer.wasm = { path: wasmPath, absolute: true };
    // Same default as That Open's IfcLoader: move far-away models near the origin.
    importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };
    includeEverything(importer);
    let last = 0;
    const output = await importer.process({
      bytes,
      progressCallback: (progress: number) => {
        // Throttle progress messages.
        if (progress - last >= 0.01 || progress === 1) {
          last = progress;
          post({ type: "progress", progress });
        }
      },
    });
    const result = output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
    post({ type: "done", bytes: result }, [result.buffer]);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
