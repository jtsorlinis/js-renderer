export type MaterialMode =
  | "ibl"
  | "pbr"
  | "normalMapped"
  | "textured"
  | "smooth"
  | "flat"
  | "unlit"
  | "depth";

export type RenderMode = "filled" | "depthWireframe" | "wireframe";

export type RenderSelectionPreset = {
  material: MaterialMode;
  renderMode?: RenderMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  tonemap?: boolean;
};

const SHADING_SELECTIONS: Record<string, RenderSelectionPreset> = {
  "tonemapped-ibl": {
    material: "ibl",
    useShadows: true,
    showEnvironmentBackground: true,
    tonemap: true,
  },
  ibl: {
    material: "ibl",
    useShadows: true,
    showEnvironmentBackground: true,
  },
  pbr: {
    material: "pbr",
    useShadows: true,
  },
  "normalMapped-shadows": {
    material: "normalMapped",
    useShadows: true,
  },
  normalMapped: {
    material: "normalMapped",
  },
  textured: {
    material: "textured",
  },
  smooth: {
    material: "smooth",
  },
  flat: {
    material: "flat",
  },
  unlit: {
    material: "unlit",
  },
  depthWireframe: {
    material: "depth",
    renderMode: "depthWireframe",
  },
  wireframe: {
    material: "depth",
    renderMode: "wireframe",
  },
};

export const resolveShadingSelection = (value: string) => {
  return SHADING_SELECTIONS[value] ?? SHADING_SELECTIONS.wireframe;
};
