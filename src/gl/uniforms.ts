import * as THREE from 'three'

/* One shared bag of uniform objects: materials reference these directly, so
   one write per frame reaches every shader that uses them. */
const u = <T>(value: T) => ({ value })

export const U = {
  uTime: u(0),
  uRes: u(new THREE.Vector2(1, 1)),
  uPaper: u(0),
  uScrollVel: u(0),
  uFlash: u(0),
  uRayO: u(new THREE.Vector3()),
  uRayD: u(new THREE.Vector3(0, 0, -1)),
  uMouseF: u(0),
}
