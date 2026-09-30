import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { hitNormal, surfaceHit } from "./surface-analysis";
import type { SurfaceVector } from "./surface-spots";

// Preview sizes in normalized model units, not a claim of physical print size.
export function createSurfaceDecal(root: THREE.Object3D, position: SurfaceVector, normal: SurfaceVector, size = "Medium") {
  const point = new THREE.Vector3().fromArray(position);
  const outward = new THREE.Vector3().fromArray(normal).normalize();
  const hit = surfaceHit(root, point, outward, 0.08);
  if (!hit || !(hit.object instanceof THREE.Mesh) || hit.point.distanceTo(point) > 0.06) return null;
  const orientation = new THREE.Object3D();
  orientation.up.set(0, Math.abs(outward.y) > 0.9 ? 0 : 1, Math.abs(outward.y) > 0.9 ? -1 : 0);
  orientation.lookAt(outward);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation.quaternion);
  const v = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation.quaternion);
  let width = size === "Large" || size === "L" ? 0.36 : size === "Small" || size === "S" ? 0.15 : 0.25;
  // Conservatively shrink at boundaries, holes and sharp bends. Checking only
  // the anchor would let a large advertisement span a window or empty space.
  let fits = false;
  for (let attempt = 0; attempt < 7; attempt++) {
    fits = true;
    for (let x = -2; x <= 2 && fits; x++) for (let y = -2; y <= 2; y++) {
      const sample = hit.point.clone().addScaledVector(u, x * width / 4).addScaledVector(v, y * width / 6.6);
      const probe = surfaceHit(root, sample, outward, 0.065);
      const n = probe && hitNormal(probe);
      if (!probe || probe.object !== hit.object || !n || n.dot(outward) < 0.82 || Math.abs(probe.point.clone().sub(sample).dot(outward)) > 0.045) { fits = false; break; }
    }
    if (fits) break;
    width *= 0.75;
  }
  if (!fits) return null;
  const geometry = new DecalGeometry(hit.object, hit.point, orientation.rotation, new THREE.Vector3(width, width / 1.65, 0.10));
  // The projector can intersect another fold of the same mesh. Keep only the
  // front-facing triangles, so a sticker never paints the back of a thin sheet.
  const vertices = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const mirrored = hit.object.matrixWorld.determinant() < 0;
  const keep: number[] = [];
  for (let i = 0; i < vertices.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertices, i);
    const b = new THREE.Vector3().fromBufferAttribute(vertices, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(vertices, i + 2);
    const faceNormal = normals
      ? new THREE.Vector3().fromBufferAttribute(normals, i).normalize()
      : b.sub(a).cross(c.sub(a)).normalize().multiplyScalar(mirrored ? -1 : 1);
    if (faceNormal.dot(outward) > 0.65) keep.push(i, mirrored ? i + 2 : i + 1, mirrored ? i + 1 : i + 2);
  }
  if (!keep.length) { geometry.dispose(); return null; }
  geometry.setIndex(keep);
  return geometry;
}
