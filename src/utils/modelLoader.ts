import type { Material } from "../materials/Material";
import { loadGlbAsset } from "./glbLoader";
import { type Mesh } from "./mesh";

export type ModelOption = {
  mesh: Mesh;
  material: Material;
};

const modelRequests = new Map<string, Promise<ModelOption>>();

// Loads each model once; later calls get the same promise, or try again if it failed
export const ensureModelUrlOption = (glbUrl: string) => {
  let request = modelRequests.get(glbUrl);
  if (!request) {
    request = loadGlbAsset(glbUrl).catch((error) => {
      modelRequests.delete(glbUrl);
      throw error;
    });
    modelRequests.set(glbUrl, request);
  }
  return request;
};
