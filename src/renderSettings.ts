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

export type RenderSelection = {
  material: MaterialMode;
  normalizedValue: string;
  renderMode?: RenderMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  tonemap?: boolean;
};

export type RenderSelectionPreset = Omit<RenderSelection, "normalizedValue">;

const DEFAULT_SHADING_SELECTION: RenderSelection = {
  material: "depth",
  renderMode: "wireframe",
  normalizedValue: "wireframe",
};

const SHADING_SELECTIONS: Partial<Record<string, RenderSelectionPreset>> = {
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
};

export const resolveShadingSelection = (value: string): RenderSelection => {
  const selection = SHADING_SELECTIONS[value];
  return selection ? { ...selection, normalizedValue: value } : DEFAULT_SHADING_SELECTION;
};
