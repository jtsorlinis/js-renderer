import { Vector3, Vector4 } from ".";

// Matrices are stored in column-major order and transform column vectors.
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

  public static RotateX(angle: number) {
    const m = Matrix4.Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.m[5] = c;
    m.m[6] = s;
    m.m[9] = -s;
    m.m[10] = c;
    return m;
  }

  public static RotateY(angle: number) {
    const m = Matrix4.Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.m[0] = c;
    m.m[2] = -s;
    m.m[8] = s;
    m.m[10] = c;
    return m;
  }

  public static RotateZ(angle: number) {
    const m = Matrix4.Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.m[0] = c;
    m.m[1] = s;
    m.m[4] = -s;
    m.m[5] = c;
    return m;
  }

  // YXZ rotation order (Yaw, Pitch, Roll)
  public static RotateYXZ(r: Vector3) {
    return Matrix4.RotateZ(r.z).multiply(Matrix4.RotateX(r.x)).multiply(Matrix4.RotateY(r.y));
  }

  public static Translate(t: Vector3) {
    const m = Matrix4.Identity();
    m.m[12] = t.x;
    m.m[13] = t.y;
    m.m[14] = t.z;
    return m;
  }

  public static TRS(t: Vector3, r: Vector3, s: Vector3) {
    return Matrix4.Translate(t).multiply(Matrix4.RotateYXZ(r)).multiply(Matrix4.Scale(s));
  }

  public static LookTo(eye: Vector3, dir: Vector3, up: Vector3) {
    const z = dir.normalize();
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

  public static LookAt(eye: Vector3, target: Vector3, up: Vector3 = Vector3.Up) {
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

  static Ortho(orthoSize: number, aspectRatio: number, near = 0.1, far = 100) {
    const orthoMat = Matrix4.Identity();
    orthoMat.m[0] = 1 / (orthoSize * aspectRatio);
    orthoMat.m[5] = 1 / orthoSize;
    orthoMat.m[10] = 1 / (far - near);
    orthoMat.m[14] = -near / (far - near);
    return orthoMat;
  }

  static Perspective(fov: number, aspectRatio: number, near = 0.1, far = 100) {
    const perspectiveMat = Matrix4.Identity();

    const fovRad = fov * (Math.PI / 180);
    const tanHalfFovy = Math.tan(fovRad / 2);

    perspectiveMat.m[0] = 1 / (aspectRatio * tanHalfFovy);
    perspectiveMat.m[5] = 1 / tanHalfFovy;
    perspectiveMat.m[10] = far / (far - near);
    perspectiveMat.m[11] = 1;
    perspectiveMat.m[14] = -near * (far / (far - near));
    perspectiveMat.m[15] = 0;

    return perspectiveMat;
  }

  public toArray() {
    return this.m;
  }

  private multiplyVector3(v: Vector3, w: number) {
    return new Vector3(
      this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z + this.m[12] * w,
      this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z + this.m[13] * w,
      this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z + this.m[14] * w,
    );
  }

  // prettier-ignore
  public multiplyVector4(v: Vector4) {
    const result = new Vector4();
    result.x = this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z + this.m[12] * v.w;
    result.y = this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z + this.m[13] * v.w;
    result.z = this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z + this.m[14] * v.w;
    result.w = this.m[3] * v.x + this.m[7] * v.y + this.m[11] * v.z + this.m[15] * v.w;

    return result;
  }

  public multiplyVector4InPlace(v: Vector4) {
    const x = v.x;
    const y = v.y;
    const z = v.z;
    const w = v.w;

    v.x = this.m[0] * x + this.m[4] * y + this.m[8] * z + this.m[12] * w;
    v.y = this.m[1] * x + this.m[5] * y + this.m[9] * z + this.m[13] * w;
    v.z = this.m[2] * x + this.m[6] * y + this.m[10] * z + this.m[14] * w;
    v.w = this.m[3] * x + this.m[7] * y + this.m[11] * z + this.m[15] * w;

    return v;
  }

  public transformPoint(v: Vector3) {
    return this.multiplyVector3(v, 1);
  }

  public transformPoint4(v: Vector3) {
    return this.multiplyVector4InPlace(v.extend(1));
  }

  public transformDirection(v: Vector3) {
    return this.multiplyVector3(v, 0);
  }

  public transformDirection4(v: Vector4) {
    return new Vector4(
      this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z,
      this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z,
      this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z,
      v.w,
    );
  }

  public multiply(m: Matrix4) {
    const a = this.m;
    const b = m.m;
    const result = new Matrix4();
    const r = result.m;

    const a00 = a[0];
    const a01 = a[1];
    const a02 = a[2];
    const a03 = a[3];
    const a10 = a[4];
    const a11 = a[5];
    const a12 = a[6];
    const a13 = a[7];
    const a20 = a[8];
    const a21 = a[9];
    const a22 = a[10];
    const a23 = a[11];
    const a30 = a[12];
    const a31 = a[13];
    const a32 = a[14];
    const a33 = a[15];

    let b0 = b[0];
    let b1 = b[1];
    let b2 = b[2];
    let b3 = b[3];
    r[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    r[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    r[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    r[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4];
    b1 = b[5];
    b2 = b[6];
    b3 = b[7];
    r[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    r[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    r[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    r[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8];
    b1 = b[9];
    b2 = b[10];
    b3 = b[11];
    r[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    r[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    r[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    r[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12];
    b1 = b[13];
    b2 = b[14];
    b3 = b[15];
    r[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    r[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    r[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    r[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

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
