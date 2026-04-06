export type MaterialMode =
  | "pathTrace"
  | "ibl"
  | "pbr"
  | "normalMappedShadows"
  | "normalMapped"
  | "textured"
  | "smooth"
  | "flat"
  | "unlit";

export type RenderMode = "filled" | "culledWireframe" | "wireframe";

export type RenderSelection = {
  material: MaterialMode;
  renderMode: RenderMode;
  useShadows: boolean;
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
    case "pathTrace":
      return {
        material: "pathTrace",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "ibl":
      return {
        material: "ibl",
        renderMode: "filled",
        useShadows: true,
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
        material: "normalMappedShadows",
        renderMode: "filled",
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped":
      return {
        material: "normalMapped",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "textured":
      return {
        material: "textured",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "smooth":
      return {
        material: "smooth",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "flat":
      return {
        material: "flat",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "unlit":
      return {
        material: "unlit",
        renderMode: "filled",
        useShadows: false,
        normalizedValue: value,
      };
    case "culledWireframe":
      return {
        material: "unlit",
        renderMode: "culledWireframe",
        useShadows: false,
        normalizedValue: value,
      };
    default:
      return {
        material: "unlit",
        renderMode: "wireframe",
        useShadows: false,
        normalizedValue: "wireframe",
      };
  }
};
