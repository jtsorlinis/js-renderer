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
  perspectiveCorrect?: boolean;
  disableTexture?: boolean;
  useSpecular?: boolean;
  snapVertices?: boolean;
  setPixelFn?:
    | "setPixelTonemapped"
    | "setPixelQuantize5"
    | "setPixelQuantize5Dither"
    | "setPixelQuantize4"
    | "setPixelQuantize4Dither";
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  vectorFade?: boolean;
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
    setPixelFn: "setPixelTonemapped",
  },
  {
    value: "ps4",
    label: "PS4",
    material: "pbr",
    resolution: 720,
    model: assetPath("head_30k.glb"),
    useShadows: true,
    setPixelFn: "setPixelTonemapped",
  },

  {
    value: "ps3-3",
    label: "PS3 Shadows",
    material: "normalMapped",
    resolution: 720,
    model: assetPath("head_5k.glb"),
    useShadows: true,
  },
  {
    value: "ps3-2",
    label: "PS3 Normal Map",
    material: "normalMapped",
    resolution: 720,
    model: assetPath("head_5k.glb"),
  },
  {
    value: "ps3",
    label: "PS3",
    material: "textured",
    resolution: 720,
    model: assetPath("head_5k.glb"),
  },
  {
    value: "ps2-2",
    label: "PS2 Specular",
    material: "gouraud",
    useSpecular: true,
    resolution: 480,
    model: assetPath("head_1k.glb"),
  },
  {
    value: "ps2",
    label: "PS2",
    material: "gouraud",
    resolution: 480,
    model: assetPath("head_1k.glb"),
  },
  {
    value: "ps1-2",
    label: "PS1 Textures",
    material: "gouraud",
    resolution: 240,
    model: assetPath("head_200.glb"),
    perspectiveCorrect: false,
    snapVertices: true,
    setPixelFn: "setPixelQuantize5Dither",
  },
  {
    value: "ps1",
    label: "PS1",
    material: "flat",
    resolution: 240,
    model: assetPath("head_200.glb"),
    perspectiveCorrect: false,
    snapVertices: true,
    setPixelFn: "setPixelQuantize5Dither",
  },
  {
    value: "snes-2",
    label: "SNES Lighting",
    material: "flat",
    resolution: 224,
    model: assetPath("head_50.glb"),
    setPixelFn: "setPixelQuantize4Dither",
  },
  {
    value: "snes",
    label: "SNES",
    material: "unlit",
    resolution: 224,
    model: assetPath("head_50.glb"),
    setPixelFn: "setPixelQuantize4Dither",
  },
  {
    value: "wireframe",
    label: "Vector",
    material: "depth",
    renderMode: "wireframe",
    model: assetPath("head_50.glb"),
    resolution: 360,
    vectorFade: true,
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
