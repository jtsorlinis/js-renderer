import { Vector3 } from ".";

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

  public multiplyVector(v: Vector3) {
    const result = new Vector3();
    result.x = this.m[0] * v.x + this.m[4] * v.y + this.m[8] * v.z + this.m[12];
    result.y = this.m[1] * v.x + this.m[5] * v.y + this.m[9] * v.z + this.m[13];
    result.z =
      this.m[2] * v.x + this.m[6] * v.y + this.m[10] * v.z + this.m[14];
    const w = this.m[3] * v.x + this.m[7] * v.y + this.m[11] * v.z + this.m[15];
    if (w != 0) {
      result.x /= w;
      result.y /= w;
      result.z /= w;
    }
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

  public print() {
    console.log(
      this.m[0].toFixed(2),
      this.m[4].toFixed(2),
      this.m[8].toFixed(2),
      this.m[12].toFixed(2)
    );
    console.log(
      this.m[1].toFixed(2),
      this.m[5].toFixed(2),
      this.m[9].toFixed(2),
      this.m[13].toFixed(2)
    );
    console.log(
      this.m[2].toFixed(2),
      this.m[6].toFixed(2),
      this.m[10].toFixed(2),
      this.m[14].toFixed(2)
    );
    console.log(
      this.m[3].toFixed(2),
      this.m[7].toFixed(2),
      this.m[11].toFixed(2),
      this.m[15].toFixed(2)
    );
  }
}
