import { Vector3 } from "../maths";
import { EPSILON } from "../shaders/pbrHelpers";
import { type LoadedModel } from "../utils/mesh";

const LEAF_TRIANGLE_COUNT = 8;
const RAY_EPSILON = 0.001;

interface BvhNode {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  start: number;
  end: number;
  left?: BvhNode;
  right?: BvhNode;
}

export interface BvhHit {
  baryU: number;
  baryV: number;
  distance: number;
  triangleIndex: number;
}

export class PathTraceBvh {
  private model?: LoadedModel;
  private root?: BvhNode;
  private triangleIndices = new Uint32Array(0);
  private centroidX = new Float32Array(0);
  private centroidY = new Float32Array(0);
  private centroidZ = new Float32Array(0);
  private boundsMinX = new Float32Array(0);
  private boundsMinY = new Float32Array(0);
  private boundsMinZ = new Float32Array(0);
  private boundsMaxX = new Float32Array(0);
  private boundsMaxY = new Float32Array(0);
  private boundsMaxZ = new Float32Array(0);

  ensureGeometry = (model: LoadedModel) => {
    if (this.model === model) {
      return false;
    }

    this.model = model;
    const triangleCount = model.vertices.length / 3;
    this.triangleIndices = new Uint32Array(triangleCount);
    this.centroidX = new Float32Array(triangleCount);
    this.centroidY = new Float32Array(triangleCount);
    this.centroidZ = new Float32Array(triangleCount);
    this.boundsMinX = new Float32Array(triangleCount);
    this.boundsMinY = new Float32Array(triangleCount);
    this.boundsMinZ = new Float32Array(triangleCount);
    this.boundsMaxX = new Float32Array(triangleCount);
    this.boundsMaxY = new Float32Array(triangleCount);
    this.boundsMaxZ = new Float32Array(triangleCount);

    for (
      let triangleIndex = 0;
      triangleIndex < triangleCount;
      triangleIndex++
    ) {
      const vertexIndex = triangleIndex * 3;
      const v0 = model.vertices[vertexIndex];
      const v1 = model.vertices[vertexIndex + 1];
      const v2 = model.vertices[vertexIndex + 2];
      this.triangleIndices[triangleIndex] = triangleIndex;
      this.centroidX[triangleIndex] = (v0.x + v1.x + v2.x) / 3;
      this.centroidY[triangleIndex] = (v0.y + v1.y + v2.y) / 3;
      this.centroidZ[triangleIndex] = (v0.z + v1.z + v2.z) / 3;
      this.boundsMinX[triangleIndex] = Math.min(v0.x, v1.x, v2.x);
      this.boundsMinY[triangleIndex] = Math.min(v0.y, v1.y, v2.y);
      this.boundsMinZ[triangleIndex] = Math.min(v0.z, v1.z, v2.z);
      this.boundsMaxX[triangleIndex] = Math.max(v0.x, v1.x, v2.x);
      this.boundsMaxY[triangleIndex] = Math.max(v0.y, v1.y, v2.y);
      this.boundsMaxZ[triangleIndex] = Math.max(v0.z, v1.z, v2.z);
    }

    this.root = this.buildNode(0, triangleCount);
    return true;
  };

  intersect = (origin: Vector3, direction: Vector3, anyHit = false) => {
    if (!this.root || !this.model) {
      return undefined;
    }

    const invDirectionX = 1 / direction.x;
    const invDirectionY = 1 / direction.y;
    const invDirectionZ = 1 / direction.z;
    const stack: BvhNode[] = [this.root];
    let closestDistance = Infinity;
    let closestTriangle = -1;
    let closestBaryU = 0;
    let closestBaryV = 0;

    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }

      if (
        !this.intersectsBounds(
          node,
          origin,
          invDirectionX,
          invDirectionY,
          invDirectionZ,
          closestDistance,
        )
      ) {
        continue;
      }

      if (!node.left || !node.right) {
        for (let i = node.start; i < node.end; i++) {
          const triangleIndex = this.triangleIndices[i];
          const hit = this.intersectTriangle(
            origin,
            direction,
            triangleIndex,
            closestDistance,
          );
          if (!hit) {
            continue;
          }

          if (anyHit) {
            return hit;
          }

          closestDistance = hit.distance;
          closestTriangle = triangleIndex;
          closestBaryU = hit.baryU;
          closestBaryV = hit.baryV;
        }
        continue;
      }

      stack.push(node.left, node.right);
    }

    if (closestTriangle < 0) {
      return undefined;
    }

    return {
      baryU: closestBaryU,
      baryV: closestBaryV,
      distance: closestDistance,
      triangleIndex: closestTriangle,
    } satisfies BvhHit;
  };

  private buildNode = (start: number, end: number): BvhNode => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let centroidMinX = Infinity;
    let centroidMinY = Infinity;
    let centroidMinZ = Infinity;
    let centroidMaxX = -Infinity;
    let centroidMaxY = -Infinity;
    let centroidMaxZ = -Infinity;

    for (let i = start; i < end; i++) {
      const triangleIndex = this.triangleIndices[i];
      minX = Math.min(minX, this.boundsMinX[triangleIndex]);
      minY = Math.min(minY, this.boundsMinY[triangleIndex]);
      minZ = Math.min(minZ, this.boundsMinZ[triangleIndex]);
      maxX = Math.max(maxX, this.boundsMaxX[triangleIndex]);
      maxY = Math.max(maxY, this.boundsMaxY[triangleIndex]);
      maxZ = Math.max(maxZ, this.boundsMaxZ[triangleIndex]);
      centroidMinX = Math.min(centroidMinX, this.centroidX[triangleIndex]);
      centroidMinY = Math.min(centroidMinY, this.centroidY[triangleIndex]);
      centroidMinZ = Math.min(centroidMinZ, this.centroidZ[triangleIndex]);
      centroidMaxX = Math.max(centroidMaxX, this.centroidX[triangleIndex]);
      centroidMaxY = Math.max(centroidMaxY, this.centroidY[triangleIndex]);
      centroidMaxZ = Math.max(centroidMaxZ, this.centroidZ[triangleIndex]);
    }

    const node: BvhNode = {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      start,
      end,
    };

    if (end - start <= LEAF_TRIANGLE_COUNT) {
      return node;
    }

    const extentX = centroidMaxX - centroidMinX;
    const extentY = centroidMaxY - centroidMinY;
    const extentZ = centroidMaxZ - centroidMinZ;

    let axis = 0;
    if (extentY > extentX && extentY >= extentZ) {
      axis = 1;
    } else if (extentZ > extentX && extentZ >= extentY) {
      axis = 2;
    }

    if (
      (axis === 0 && extentX <= EPSILON) ||
      (axis === 1 && extentY <= EPSILON) ||
      (axis === 2 && extentZ <= EPSILON)
    ) {
      return node;
    }

    const axisValues =
      axis === 0
        ? this.centroidX
        : axis === 1
          ? this.centroidY
          : this.centroidZ;
    this.triangleIndices.subarray(start, end).sort((a, b) => {
      return axisValues[a] - axisValues[b];
    });

    const mid = start + ((end - start) >> 1);
    if (mid === start || mid === end) {
      return node;
    }

    node.left = this.buildNode(start, mid);
    node.right = this.buildNode(mid, end);
    return node;
  };

  private intersectsBounds = (
    node: BvhNode,
    origin: Vector3,
    invDirectionX: number,
    invDirectionY: number,
    invDirectionZ: number,
    maxDistance: number,
  ) => {
    let tMin =
      ((invDirectionX >= 0 ? node.minX : node.maxX) - origin.x) * invDirectionX;
    let tMax =
      ((invDirectionX >= 0 ? node.maxX : node.minX) - origin.x) * invDirectionX;
    const tyMin =
      ((invDirectionY >= 0 ? node.minY : node.maxY) - origin.y) * invDirectionY;
    const tyMax =
      ((invDirectionY >= 0 ? node.maxY : node.minY) - origin.y) * invDirectionY;

    if (tMin > tyMax || tyMin > tMax) {
      return false;
    }

    tMin = Math.max(tMin, tyMin);
    tMax = Math.min(tMax, tyMax);

    const tzMin =
      ((invDirectionZ >= 0 ? node.minZ : node.maxZ) - origin.z) * invDirectionZ;
    const tzMax =
      ((invDirectionZ >= 0 ? node.maxZ : node.minZ) - origin.z) * invDirectionZ;

    if (tMin > tzMax || tzMin > tMax) {
      return false;
    }

    tMin = Math.max(tMin, tzMin);
    tMax = Math.min(tMax, tzMax);
    return tMax >= Math.max(tMin, 0) && tMin < maxDistance;
  };

  private intersectTriangle = (
    origin: Vector3,
    direction: Vector3,
    triangleIndex: number,
    maxDistance: number,
  ) => {
    if (!this.model) {
      return undefined;
    }

    const vertexOffset = triangleIndex * 3;
    const v0 = this.model.vertices[vertexOffset];
    const v1 = this.model.vertices[vertexOffset + 1];
    const v2 = this.model.vertices[vertexOffset + 2];
    const edge1X = v1.x - v0.x;
    const edge1Y = v1.y - v0.y;
    const edge1Z = v1.z - v0.z;
    const edge2X = v2.x - v0.x;
    const edge2Y = v2.y - v0.y;
    const edge2Z = v2.z - v0.z;
    const pX = direction.y * edge2Z - direction.z * edge2Y;
    const pY = direction.z * edge2X - direction.x * edge2Z;
    const pZ = direction.x * edge2Y - direction.y * edge2X;
    const determinant = edge1X * pX + edge1Y * pY + edge1Z * pZ;

    if (Math.abs(determinant) <= EPSILON) {
      return undefined;
    }

    const inverseDeterminant = 1 / determinant;
    const tX = origin.x - v0.x;
    const tY = origin.y - v0.y;
    const tZ = origin.z - v0.z;
    const baryU = (tX * pX + tY * pY + tZ * pZ) * inverseDeterminant;
    if (baryU < 0 || baryU > 1) {
      return undefined;
    }

    const qX = tY * edge1Z - tZ * edge1Y;
    const qY = tZ * edge1X - tX * edge1Z;
    const qZ = tX * edge1Y - tY * edge1X;
    const baryV =
      (direction.x * qX + direction.y * qY + direction.z * qZ) *
      inverseDeterminant;
    if (baryV < 0 || baryU + baryV > 1) {
      return undefined;
    }

    const distance =
      (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverseDeterminant;
    if (distance <= RAY_EPSILON || distance >= maxDistance) {
      return undefined;
    }

    return {
      baryU,
      baryV,
      distance,
      triangleIndex,
    } satisfies BvhHit;
  };
}
