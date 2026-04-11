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
};

export const resolveShadingSelection = (value: string): RenderSelection => {
  switch (value) {
    case "ibl":
      return {
        material: "ibl",
        useShadows: true,
        showEnvironmentBackground: true,
        normalizedValue: value,
      };
    case "pbr":
      return {
        material: "pbr",
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped-shadows":
      return {
        material: "normalMapped",
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped":
      return {
        material: "normalMapped",
        normalizedValue: value,
      };
    case "textured":
      return {
        material: "textured",
        normalizedValue: value,
      };
    case "smooth":
      return {
        material: "smooth",
        normalizedValue: value,
      };
    case "flat":
      return {
        material: "flat",
        normalizedValue: value,
      };
    case "unlit":
      return {
        material: "unlit",
        normalizedValue: value,
      };
    case "depthWireframe":
      return {
        material: "depth",
        renderMode: "depthWireframe",
        normalizedValue: value,
      };
    default:
      return {
        material: "depth",
        renderMode: "wireframe",
        normalizedValue: "wireframe",
      };
  }
};
