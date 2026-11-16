export type MaterialMode =
  | "ibl"
  | "pbr"
  | "normalMapped"
  | "textured"
  | "gouraud"
  | "flat"
  | "unlit"
  | "depth";

export type RenderMode = "filled" | "depthWireframe" | "wireframe";
export type TextureFiltering = "nearest" | "bilinear";

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
  setPixelFn?: "setPixelTonemapped" | "setPixelQuantize5Dither" | "setPixelQuantize4Dither";
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  textureFiltering?: TextureFiltering;
  vectorFade?: boolean;
};

const assetPath = (fileName: string) => `${import.meta.env.BASE_URL}models/heads/${fileName}`;

export type ShadingPreset = {
  value: string;
  label: string;
  // Release year of the console the preset imitates, shown next to its name
  year: number;
} & Omit<RenderSelection, "normalizedValue">;

export const SHADING_PRESETS = [
  {
    value: "ps5",
    label: "PS5",
    year: 2020,
    material: "ibl",
    resolution: 1440,
    model: assetPath("head_50k.glb"),
    useShadows: true,
    showEnvironmentBackground: true,
    setPixelFn: "setPixelTonemapped",
  },
  {
    value: "ps4",
    label: "PS4",
    year: 2013,
    material: "pbr",
    resolution: 1080,
    model: assetPath("head_30k.glb"),
    useShadows: true,
    setPixelFn: "setPixelTonemapped",
  },

  {
    value: "ps3-3",
    label: "PS3 Shadows",
    year: 2006,
    material: "normalMapped",
    resolution: 720,
    model: assetPath("head_5k.glb"),
    useShadows: true,
  },
  {
    value: "ps3-2",
    label: "PS3 Normal Map",
    year: 2006,
    material: "normalMapped",
    resolution: 720,
    model: assetPath("head_5k.glb"),
  },
  {
    value: "ps3",
    label: "PS3",
    year: 2006,
    material: "textured",
    resolution: 720,
    model: assetPath("head_5k.glb"),
  },
  {
    value: "ps2-2",
    label: "PS2 Specular",
    year: 2000,
    material: "gouraud",
    useSpecular: true,
    resolution: 480,
    model: assetPath("head_1k.glb"),
    textureFiltering: "bilinear",
  },
  {
    value: "ps2",
    label: "PS2",
    year: 2000,
    material: "gouraud",
    resolution: 480,
    model: assetPath("head_1k.glb"),
    textureFiltering: "bilinear",
  },
  {
    value: "ps1-2",
    label: "PS1 Textures",
    year: 1994,
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
    year: 1994,
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
    year: 1990,
    material: "flat",
    resolution: 224,
    model: assetPath("head_50.glb"),
    setPixelFn: "setPixelQuantize4Dither",
  },
  {
    value: "snes",
    label: "SNES",
    year: 1990,
    material: "unlit",
    resolution: 224,
    model: assetPath("head_50.glb"),
    setPixelFn: "setPixelQuantize4Dither",
  },
  {
    value: "wireframe",
    label: "Vector",
    year: 1982,
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
  const { value: normalizedValue, label: _label, year: _year, ...selection } = preset;
  return { ...selection, normalizedValue };
};
