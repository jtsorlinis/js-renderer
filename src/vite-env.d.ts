/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module "*.wgsl?raw" {
  const source: string;
  export default source;
}

declare module "*.obj?raw" {
  const source: string;
  export default source;
}
