export type MaterialMode =
  | "ibl"
  | "pbr"
  | "normalMapped"
  | "textured"
  | "smooth"
  | "flat"
  | "unlit";

export type RenderMode = "filled" | "depthWireframe" | "wireframe";
export type ProjectionMode = "orthographic" | "perspective";

export type RenderSelection = {
  material: MaterialMode;
  normalizedValue: string;
  renderMode?: RenderMode;
  projection?: ProjectionMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
};

export const resolveShadingSelection = (
  rawValue: string,
  canUseTexturedModes: boolean,
): RenderSelection => {
  let value = rawValue;

  if (
    !canUseTexturedModes &&
    (value === "ibl" ||
      value === "pbr" ||
      value === "textured" ||
      value.includes("normalMapped"))
  ) {
    value = "smooth";
  }

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
        material: "unlit",
        renderMode: "depthWireframe",
        normalizedValue: value,
      };
    case "perspective":
      return {
        material: "unlit",
        renderMode: "wireframe",
        normalizedValue: value,
      };
    default:
      return {
        material: "unlit",
        renderMode: "wireframe",
        projection: "orthographic",
        normalizedValue: "wireframe",
      };
  }
};
