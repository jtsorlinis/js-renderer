export type MaterialMode =
  | "ibl"
  | "pbr"
  | "normalMapped"
  | "textured"
  | "gouraudTextured"
  | "gouraud"
  | "smooth"
  | "flat"
  | "unlit"
  | "depth";

export type RenderMode = "filled" | "depthWireframe" | "wireframe";

export type RenderSelection = {
  material: MaterialMode;
  normalizedValue: string;
  resolution?: number;
  model?: string;
  renderMode?: RenderMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
};

const assetPath = (fileName: string) => `${import.meta.env.BASE_URL}models/heads/${fileName}`;

export type ShadingPreset = {
  value: string;
  label: string;
} & Omit<RenderSelection, "normalizedValue">;

export const SHADING_PRESETS = [
  {
    value: "ps5",
    label: "PS5",
    material: "ibl",
    resolution: 720,
    model: assetPath("head_50k.glb"),
    useShadows: true,
    showEnvironmentBackground: true,
  },
  {
    value: "ps4",
    label: "PS4",
    material: "pbr",
    resolution: 720,
    model: assetPath("head_30k.glb"),
    useShadows: true,
  },
  {
    value: "ps3-2",
    label: "PS3 Normal Map",
    material: "normalMapped",
    resolution: 720,
    model: assetPath("head_5k.glb"),
    useShadows: true,
  },
  {
    value: "ps3",
    label: "PS3",
    material: "textured",
    resolution: 720,
    model: assetPath("head_5k.glb"),
    useShadows: true,
  },
  {
    value: "ps2-2",
    label: "PS2 Shadows",
    material: "textured",
    resolution: 480,
    model: assetPath("head_1k.glb"),
    useShadows: true,
  },
  {
    value: "ps2-1",
    label: "PS2 Fragment",
    material: "textured",
    resolution: 480,
    model: assetPath("head_1k.glb"),
  },
  {
    value: "ps2",
    label: "PS2",
    material: "gouraudTextured",
    resolution: 480,
    model: assetPath("head_1k.glb"),
  },
  {
    value: "ps1-4",
    label: "PS1 Textures",
    material: "gouraudTextured",
    resolution: 240,
    model: assetPath("head_100.glb"),
  },
  {
    value: "ps1-3",
    label: "PS1 Smooth",
    material: "gouraud",
    resolution: 240,
    model: assetPath("head_100.glb"),
  },
  {
    value: "ps1",
    label: "PS1",
    material: "flat",
    resolution: 240,
    model: assetPath("head_100.glb"),
  },
  {
    value: "snes-2",
    label: "SNES Lighting",
    material: "flat",
    resolution: 192,
    model: assetPath("head_50.glb"),
  },
  {
    value: "snes-3",
    label: "SNES",
    material: "unlit",
    resolution: 192,
    model: assetPath("head_50.glb"),
  },
  {
    value: "wireframe",
    label: "Wireframe",
    material: "depth",
    renderMode: "wireframe",
    model: assetPath("head_50.glb"),
    resolution: 192,
  },
] satisfies ShadingPreset[];

const FALLBACK_SHADING_PRESET =
  SHADING_PRESETS.find((preset) => preset.value === "wireframe") ?? SHADING_PRESETS[0];

export const resolveShadingSelection = (value: string): RenderSelection => {
  const preset =
    SHADING_PRESETS.find((candidate) => candidate.value === value) ?? FALLBACK_SHADING_PRESET;
  const { value: normalizedValue, label: _label, ...selection } = preset;
  return { ...selection, normalizedValue };
};
