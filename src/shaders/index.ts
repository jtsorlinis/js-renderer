import { DepthShader } from "./Depth";
import { FlatShader } from "./Flat";
import { GouraudShader } from "./Gouraud";
import { IblShader } from "./Ibl";
import { NormalMappedShader } from "./NormalMapped";
import { PbrShader } from "./Pbr";
import { TexturedShader } from "./Textured";
import { UnlitShader } from "./Unlit";

export const createShaders = () => ({
  ibl: new IblShader(),
  pbr: new PbrShader(),
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  gouraud: new GouraudShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
  depth: new DepthShader(),
});
