export type MaterialMode =
  | "ibl"
  | "pbr"
  | "normalMapped"
  | "textured"
  | "smooth"
  | "flat"
  | "unlit";

export type RenderMode = "filled" | "depthWireframe" | "wireframe";

export type RenderSelection = {
  material: MaterialMode;
  renderMode: RenderMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  normalizedValue: string;
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
        renderMode: "filled",
        useShadows: true,
        showEnvironmentBackground: true,
        normalizedValue: value,
      };
    case "pbr":
      return {
        material: "pbr",
        renderMode: "filled",
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped-shadows":
      return {
        material: "normalMapped",
        renderMode: "filled",
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped":
      return {
        material: "normalMapped",
        renderMode: "filled",
        normalizedValue: value,
      };
    case "textured":
      return {
        material: "textured",
        renderMode: "filled",
        normalizedValue: value,
      };
    case "smooth":
      return {
        material: "smooth",
        renderMode: "filled",
        normalizedValue: value,
      };
    case "flat":
      return {
        material: "flat",
        renderMode: "filled",
        normalizedValue: value,
      };
    case "unlit":
      return {
        material: "unlit",
        renderMode: "filled",
        normalizedValue: value,
      };
    case "depthWireframe":
      return {
        material: "unlit",
        renderMode: "depthWireframe",
        normalizedValue: value,
      };
    default:
      return {
        material: "unlit",
        renderMode: "wireframe",
        normalizedValue: "wireframe",
      };
  }
};
