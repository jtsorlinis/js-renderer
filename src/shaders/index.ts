import { DepthShader } from "./Depth";
import { FlatShader } from "./Flat";
import { IblShader } from "./Ibl";
import { NormalMappedShader } from "./NormalMapped";
import { PbrShader } from "./Pbr";
import { SmoothShader } from "./Smooth";
import { TexturedShader } from "./Textured";
import { UnlitShader } from "./Unlit";

export const createShaders = () => ({
  ibl: new IblShader(),
  pbr: new PbrShader(),
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
  depth: new DepthShader(),
});
