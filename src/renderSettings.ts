export type MaterialMode = "normalMapped" | "textured" | "smooth" | "flat";

export type RenderSelection = {
  material: MaterialMode;
  wireframe: boolean;
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
    (value.includes("textured") || value.includes("normalMapped"))
  ) {
    value = "smooth";
  }

  switch (value) {
    case "normalMapped-shadows":
      return {
        material: "normalMapped",
        wireframe: false,
        useShadows: true,
        normalizedValue: value,
      };
    case "normalMapped":
      return {
        material: "normalMapped",
        wireframe: false,
        useShadows: false,
        normalizedValue: value,
      };
    case "textured":
      return {
        material: "textured",
        wireframe: false,
        useShadows: false,
        normalizedValue: value,
      };
    case "smooth":
      return {
        material: "smooth",
        wireframe: false,
        useShadows: false,
        normalizedValue: value,
      };
    case "flat":
      return {
        material: "flat",
        wireframe: false,
        useShadows: false,
        normalizedValue: value,
      };
    default:
      return {
        material: "smooth",
        wireframe: true,
        useShadows: false,
        normalizedValue: "wireframe",
      };
  }
};
