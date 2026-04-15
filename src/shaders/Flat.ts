import { Vector3, Matrix4 } from "../maths";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
  paletteMode?: "snes";
}

const ambient = 0.1;
const baseColor = Vector3.One.scale(0.5);
const snesSteps = 6;
const quantizeSnesLighting = (lighting: number) => Math.round(lighting * snesSteps) / snesSteps;

export class FlatShader extends BaseShader<Uniforms> {
  // Flat shading stores one lighting value for the whole triangle.
  lighting = new Vector3();

  vertex = () => {
    const model = this.uniforms.model;

    // Use one shared lighting value for the whole triangle.
    if (this.nthVert === 0) {
      const worldNormal = this.uniforms.normalMat
        .transformDirection(model.faceNormals[this.vertexId])
        .normalize();
      const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
      const lighting =
        this.uniforms.paletteMode === "snes"
          ? quantizeSnesLighting(diffuse + ambient)
          : diffuse + ambient;
      this.lighting =
        this.uniforms.paletteMode === "snes"
          ? baseColor.scale(lighting)
          : baseColor.scale(lighting);
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.lighting;
  };
}
