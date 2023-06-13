import { BaseShader } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class FlatShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Attributes
  normal = new Vector3();
  intensity = 0;

  vertex = (i: number): Vector3 => {
    const pos = this.uniforms.mvp.multPerspectiveDiv(this.model.vertices[i]);
    this.normal = this.uniforms.rotMat.multiplyVector3(
      this.model.flatNormals[i]
    );
    this.intensity = -this.normal.dot(this.uniforms.lightDir);

    return pos;
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.intensity);
  };
}
