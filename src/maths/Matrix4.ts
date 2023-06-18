import { Vector3, Vector4 } from ".";

export class Matrix4 {
  m: Float32Array;
  constructor() {
    this.m = new Float32Array(16);
  }

  public static Identity() {
    const m = new Matrix4();
    m.m[0] = 1;
    m.m[5] = 1;
    m.m[10] = 1;
    m.m[15] = 1;
    return m;
  }

  public static Scale(s: Vector3) {
    const m = Matrix4.Identity();
    m.m[0] = s.x;
    m.m[5] = s.y;
    m.m[10] = s.z;
    return m;
  }

  // ZXY rotation order
  public static RotateEuler(r: Vector3) {
    const m = Matrix4.Identity();
    const cx = Math.cos(r.x);
    const sx = Math.sin(r.x);
    const cy = Math.cos(r.y);
    const sy = Math.sin(r.y);
    const cz = Math.cos(r.z);
    const sz = Math.sin(r.z);

    m.m[0] = cz * cy - sz * sx * sy;
    m.m[1] = -sz * cx;
    m.m[2] = cz * sy + sz * sx * cy;

    m.m[4] = sz * cy + cz * sx * sy;
    m.m[5] = cx * cz;
    m.m[6] = sz * sy - cz * sx * cy;

    m.m[8] = -cx * sy;
    m.m[9] = sx;
    m.m[10] = cx * cy;

    return m;
  }

  public static Translate(t: Vector3) {
    const m = Matrix4.Identity();
    m.m[12] = t.x;
    m.m[13] = t.y;
    m.m[14] = t.z;
    return m;
  }

  public static TRS(t: Vector3, r: Vector3, s: Vector3) {
    return Matrix4.Scale(s)
      .multiply(Matrix4.RotateEuler(r))
      .multiply(Matrix4.Translate(t));
  }

  public static LookAt(eye: Vector3, target: Vector3, up: Vector3) {
    const z = target.subtract(eye).normalize();
    const x = up.cross(z).normalize();
    const y = z.cross(x).normalize();

    const m = Matrix4.Identity();
    m.m[0] = x.x;
    m.m[1] = y.x;
    m.m[2] = z.x;
    m.m[4] = x.y;
    m.m[5] = y.y;
    m.m[6] = z.y;
    m.m[8] = x.z;
    m.m[9] = y.z;
    m.m[10] = z.z;
    m.m[12] = -x.dot(eye);
    m.m[13] = -y.dot(eye);
    m.m[14] = -z.dot(eye);
    return m;
  }

  static Ortho(orthoSize: number, image: ImageData, near = 0.1, far = 1000) {
    const orthoMat = Matrix4.Identity();
    const aspect = image.width / image.height;
    orthoMat.m[0] = 1 / (orthoSize * aspect);
    orthoMat.m[5] = 1 / orthoSize;
    orthoMat.m[10] = 1 / (far - near);
    orthoMat.m[14] = -near / (far - near);
    return orthoMat;
  }

  static Perspective(fov: number, image: ImageData, near = 0.1, far = 1000) {
    const perspectiveMat = Matrix4.Identity();
    const aspect = image.width / image.height;
    const fovRad = fov * (Math.PI / 180);
    const tanHalfFovy = Math.tan(fovRad / 2);

    perspectiveMat.m[0] = 1 / (aspect * tanHalfFovy);
    perspectiveMat.m[5] = 1 / tanHalfFovy;
    perspectiveMat.m[10] = far / (far - near);
    perspectiveMat.m[11] = 1;
    perspectiveMat.m[14] = -near * (far / (far - near));
    perspectiveMat.m[15] = 0;

    return perspectiveMat;
  }

  // prettier-ignore
  public multiplyVector4(v: Vector4) {
    const result = new Vector4();
    result.x = this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z + this.m[12];
    result.y = this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z + this.m[13];
    result.z = this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z + this.m[14];
    result.w = this.m[3] * v.x + this.m[7] * v.y + this.m[11] * v.z + this.m[15];

    return result;
  }

  // Perspective division is normally automatically done by the GPU, but we need to do it manually
  // prettier-ignore
  public multiplyPoint(v: Vector4) {
    const w = this.m[3] * v.x + this.m[7] * v.y + this.m[11] * v.z + this.m[15];
    const invW = 1 / w
    const result = new Vector4();
    result.x = (this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z + this.m[12]) * invW;
    result.y = (this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z + this.m[13]) * invW;
    result.z = (this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z + this.m[14]) * invW;
    result.w = w;
  
    return result;
  }

  public multiplyDirection(v: Vector3) {
    const result = new Vector3();
    result.x = this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z;
    result.y = this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z;
    result.z = this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z;

    return result;
  }

  // prettier-ignore
  public multiply(m: Matrix4) {
    const result = new Matrix4();
    
    result.m[0] = this.m[0] * m.m[0] + this.m[1] * m.m[4] + this.m[2] * m.m[8] + this.m[3] * m.m[12];
    result.m[1] = this.m[0] * m.m[1] + this.m[1] * m.m[5] + this.m[2] * m.m[9] + this.m[3] * m.m[13];
    result.m[2] = this.m[0] * m.m[2] + this.m[1] * m.m[6] + this.m[2] * m.m[10] + this.m[3] * m.m[14];
    result.m[3] = this.m[0] * m.m[3] + this.m[1] * m.m[7] + this.m[2] * m.m[11] + this.m[3] * m.m[15];
  
    result.m[4] = this.m[4] * m.m[0] + this.m[5] * m.m[4] + this.m[6] * m.m[8] + this.m[7] * m.m[12];
    result.m[5] = this.m[4] * m.m[1] + this.m[5] * m.m[5] + this.m[6] * m.m[9] + this.m[7] * m.m[13];
    result.m[6] = this.m[4] * m.m[2] + this.m[5] * m.m[6] + this.m[6] * m.m[10] + this.m[7] * m.m[14];
    result.m[7] = this.m[4] * m.m[3] + this.m[5] * m.m[7] + this.m[6] * m.m[11] + this.m[7] * m.m[15];
  
    result.m[8] = this.m[8] * m.m[0] + this.m[9] * m.m[4] + this.m[10] * m.m[8] + this.m[11] * m.m[12];
    result.m[9] = this.m[8] * m.m[1] + this.m[9] * m.m[5] + this.m[10] * m.m[9] + this.m[11] * m.m[13];
    result.m[10] = this.m[8] * m.m[2] + this.m[9] * m.m[6] + this.m[10] * m.m[10] + this.m[11] * m.m[14];
    result.m[11] = this.m[8] * m.m[3] + this.m[9] * m.m[7] + this.m[10] * m.m[11] + this.m[11] * m.m[15];
  
    result.m[12] = this.m[12] * m.m[0] + this.m[13] * m.m[4] + this.m[14] * m.m[8] + this.m[15] * m.m[12];
    result.m[13] = this.m[12] * m.m[1] + this.m[13] * m.m[5] + this.m[14] * m.m[9] + this.m[15] * m.m[13];
    result.m[14] = this.m[12] * m.m[2] + this.m[13] * m.m[6] + this.m[14] * m.m[10] + this.m[15] * m.m[14];
    result.m[15] = this.m[12] * m.m[3] + this.m[13] * m.m[7] + this.m[14] * m.m[11] + this.m[15] * m.m[15];
  
    return result;
  }

  public transpose() {
    const result = new Matrix4();
    result.m[0] = this.m[0];
    result.m[1] = this.m[4];
    result.m[2] = this.m[8];
    result.m[3] = this.m[12];

    result.m[4] = this.m[1];
    result.m[5] = this.m[5];
    result.m[6] = this.m[9];
    result.m[7] = this.m[13];

    result.m[8] = this.m[2];
    result.m[9] = this.m[6];
    result.m[10] = this.m[10];
    result.m[11] = this.m[14];

    result.m[12] = this.m[3];
    result.m[13] = this.m[7];
    result.m[14] = this.m[11];
    result.m[15] = this.m[15];

    return result;
  }

  // prettier-ignore
  public invert() {
      let m = this.m;
      let result = new Matrix4();
    
      // calculate the adjugate of m
      result.m[0]  =  m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
      result.m[4]  = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
      result.m[8]  =  m[4] * m[9]  * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
      result.m[12] = -m[4] * m[9]  * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
      result.m[1]  = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
      result.m[5]  =  m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
      result.m[9]  = -m[0] * m[9]  * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
      result.m[13] =  m[0] * m[9]  * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
      result.m[2]  =  m[1] * m[6]  * m[15] - m[1] * m[7]  * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7]  - m[13] * m[3] * m[6];
      result.m[6]  = -m[0] * m[6]  * m[15] + m[0] * m[7]  * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7]  + m[12] * m[3] * m[6];
      result.m[10] =  m[0] * m[5]  * m[15] - m[0] * m[7]  * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7]  - m[12] * m[3] * m[5];
      result.m[14] = -m[0] * m[5]  * m[14] + m[0] * m[6]  * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6]  + m[12] * m[2] * m[5];
      result.m[3]  = -m[1] * m[6]  * m[11] + m[1] * m[7]  * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9]  * m[2] * m[7]  + m[9]  * m[3] * m[6];
      result.m[7]  =  m[0] * m[6]  * m[11] - m[0] * m[7]  * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8]  * m[2] * m[7]  - m[8]  * m[3] * m[6];
      result.m[11] = -m[0] * m[5]  * m[11] + m[0] * m[7]  * m[9]  + m[4] * m[1] * m[11] - m[4] * m[3] * m[9]  - m[8]  * m[1] * m[7]  + m[8]  * m[3] * m[5];
      result.m[15] =  m[0] * m[5]  * m[10] - m[0] * m[6]  * m[9]  - m[4] * m[1] * m[10] + m[4] * m[2] * m[9]  + m[8]  * m[1] * m[6]  - m[8]  * m[2] * m[5];
  
      // calculate the determinant of m
      let det = m[0] * result.m[0] + m[1] * result.m[4] + m[2] * result.m[8] + m[3] * result.m[12];
  
      if (det === 0) {
        return new Matrix4();
      }
  
      // calculate the inverse of m by dividing the adjugate by the determinant
      const invDet = 1 / det;
      result.m[0] *= invDet;
      result.m[1] *= invDet;
      result.m[2] *= invDet;
      result.m[3] *= invDet;
      result.m[4] *= invDet;
      result.m[5] *= invDet;
      result.m[6] *= invDet;
      result.m[7] *= invDet;
      result.m[8] *= invDet;
      result.m[9] *= invDet;
      result.m[10] *= invDet;
      result.m[11] *= invDet;
      result.m[12] *= invDet;
      result.m[13] *= invDet;
      result.m[14] *= invDet;
      result.m[15] *= invDet;
     
      return result;
  }

  // prettier-ignore
  public print() {
    console.log(this.m[0].toFixed(2), this.m[4].toFixed(2), this.m[8].toFixed(2), this.m[12].toFixed(2));
    console.log(this.m[1].toFixed(2), this.m[5].toFixed(2), this.m[9].toFixed(2), this.m[13].toFixed(2));
    console.log(this.m[2].toFixed(2), this.m[6].toFixed(2), this.m[10].toFixed(2), this.m[14].toFixed(2));
    console.log(this.m[3].toFixed(2), this.m[7].toFixed(2), this.m[11].toFixed(2), this.m[15].toFixed(2));
  }
}
