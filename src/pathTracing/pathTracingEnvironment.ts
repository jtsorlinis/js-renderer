import { Texture } from "../drawing";
import { Vector3 } from "../maths";
import {
  environmentDirectionToUv,
  environmentUvToDirection,
  sampleEnvironment,
} from "./pathTracingHelpers";

const ENVIRONMENT_PDF_EPSILON = 0.000001;

export interface EnvironmentLightSample {
  direction: Vector3;
  pdf: number;
  radiance: Vector3;
}

export class PathTraceEnvironmentSampler {
  private environmentCdf = new Float32Array(0);
  private environmentWeightTotal = 0;
  private sampledEnvironment: Texture | null = null;

  ensureSampling = (environment: Texture) => {
    if (this.sampledEnvironment === environment) {
      return false;
    }

    this.sampledEnvironment = environment;
    this.environmentCdf = new Float32Array(
      environment.width * environment.height,
    );
    this.environmentWeightTotal = 0;

    for (let y = 0; y < environment.height; y++) {
      const sinTheta = Math.sin(((y + 0.5) / environment.height) * Math.PI);
      for (let x = 0; x < environment.width; x++) {
        const weight = this.getTexelLuminance(environment, x, y) * sinTheta;
        this.environmentWeightTotal += weight;
        this.environmentCdf[x + y * environment.width] =
          this.environmentWeightTotal;
      }
    }

    return true;
  };

  sampleLight = (
    environment: Texture,
    envYawCos: number,
    envYawSin: number,
    nextRandom: () => number,
  ): EnvironmentLightSample | undefined => {
    if (this.environmentWeightTotal <= 0 || this.environmentCdf.length === 0) {
      return undefined;
    }

    const sampleIndex = this.sampleTexelIndex(nextRandom);
    const texelX = sampleIndex % environment.width;
    const texelY = Math.floor(sampleIndex / environment.width);
    const texelLuminance = this.getTexelLuminance(environment, texelX, texelY);
    if (texelLuminance <= 0) {
      return undefined;
    }

    const u = (texelX + nextRandom()) / environment.width;
    const v = (texelY + nextRandom()) / environment.height;
    const direction = environmentUvToDirection(u, v, envYawCos, envYawSin);
    return {
      direction,
      pdf: Math.max(
        ENVIRONMENT_PDF_EPSILON,
        (texelLuminance * environment.width * environment.height) /
          (2 * Math.PI * Math.PI * this.environmentWeightTotal),
      ),
      radiance: sampleEnvironment(environment, envYawCos, envYawSin, direction),
    };
  };

  directionPdf = (
    environment: Texture,
    envYawCos: number,
    envYawSin: number,
    direction: Vector3,
  ) => {
    if (this.environmentWeightTotal <= 0 || this.environmentCdf.length === 0) {
      return 0;
    }

    const { u, v } = environmentDirectionToUv(direction, envYawCos, envYawSin);
    const texelX = Math.min(
      environment.width - 1,
      Math.floor(u * environment.width),
    );
    const texelY = Math.min(
      environment.height - 1,
      Math.floor(v * environment.height),
    );
    const texelLuminance = this.getTexelLuminance(environment, texelX, texelY);
    if (texelLuminance <= 0) {
      return 0;
    }

    return Math.max(
      ENVIRONMENT_PDF_EPSILON,
      (texelLuminance * environment.width * environment.height) /
        (2 * Math.PI * Math.PI * this.environmentWeightTotal),
    );
  };

  private sampleTexelIndex = (nextRandom: () => number) => {
    const target = nextRandom() * this.environmentWeightTotal;
    let low = 0;
    let high = this.environmentCdf.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (target <= this.environmentCdf[mid]) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return low;
  };

  private getTexelLuminance = (environment: Texture, x: number, y: number) => {
    const base = (x + y * environment.width) * 3;
    return (
      environment.data[base] * 0.2126 +
      environment.data[base + 1] * 0.7152 +
      environment.data[base + 2] * 0.0722
    );
  };
}
