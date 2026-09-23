import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { PRESET_SURFACES } from "./preset-surfaces";
import type { PresetModelId } from "./preset-models";
import { MAX_SURFACE_SPOTS, RECOMMENDED_SURFACE_SPOTS, type SurfaceModelAnalysis, type SurfacePlacementProfile, type SurfaceVector } from "./surface-spots";

export function prepareSurfaceRaycasting(root: THREE.Object3D) {
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh) return;
    if (!child.geometry.getAttribute("position")) return;
    child.geometry.boundsTree ??= new MeshBVH(child.geometry, { indirect: true });
    child.raycast = acceleratedRaycast;
  });
}

export function vectorTuple(v: THREE.Vector3): SurfaceVector { return [v.x, v.y, v.z]; }

export function hitNormal(hit: THREE.Intersection): THREE.Vector3 | null {
  if (!hit.face) return null;
  return hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
}

// Preserve authored winding: flipping normals relative to the object's centre is
// incorrect on concave objects, disconnected parts and human scans.
export function surfaceHit(root: THREE.Object3D, point: THREE.Vector3, outward: THREE.Vector3, distance = 4) {
  const ray = new THREE.Raycaster(point.clone().addScaledVector(outward, distance), outward.clone().negate(), 0, distance * 2);
  ray.firstHitOnly = true;
  return ray.intersectObject(root, true).find(hit => hit.object.visible && hit.face);
}

type Face = { point: THREE.Vector3; normal: THREE.Vector3; area: number; vertices: THREE.Vector3[]; neighbors: number[]; material: number };

/** Connected region growing, with both local and seed-relative curvature limits.
 * Area is summed from ALL triangles, not triangle-count/stride estimates.
 * UV seams are welded by position; separate meshes/materials remain separate.
 */
export function analyzeModelSurface(root: THREE.Object3D, profile: SurfacePlacementProfile, presetId?: PresetModelId): SurfaceModelAnalysis {
  root.updateMatrixWorld(true);
  prepareSurfaceRaycasting(root);
  if (presetId) {
    const placements = PRESET_SURFACES[presetId].flatMap(target => {
      const normal = new THREE.Vector3().fromArray(target.outward);
      const hit = surfaceHit(root, new THREE.Vector3().fromArray(target.target), normal, target.distance);
      const actualNormal = hit && hitNormal(hit);
      if (!hit || !actualNormal || actualNormal.dot(normal) < 0.45) return [];
      return [{ id: 0, region: target.region, position: vectorTuple(hit.point), normal: vectorTuple(actualNormal) }];
    }).map((spot, i) => ({ ...spot, id: i + 1 }));
    return { recommendedCount: Math.min(RECOMMENDED_SURFACE_SPOTS[profile], placements.length), usableSideArea: 0, placements };
  }
  const candidates: { point: THREE.Vector3; normal: THREE.Vector3; area: number; alternatives: { point: THREE.Vector3; normal: THREE.Vector3 }[]; mesh: THREE.Mesh }[] = [];
  let processed = 0;
  let limited = false;
  root.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const indices = geometry.getIndex();
    const count = Math.floor((indices?.count ?? positions.count) / 3);
    // Avoid blocking the UI indefinitely on unbounded uploads. Do not stride
    // triangles: that destroys the topology. Report missing recommendations.
    if (processed + count > 250_000) { limited = true; return; }
    processed += count;
    const faces: Face[] = [];
    const edges = new Map<string, number[]>();
    const vertexKey = (v: THREE.Vector3) => v.toArray().map(x => Math.round(x / 0.00001)).join(",");
    for (let i = 0; i < count; i++) {
      const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i * 3 + j) : i * 3 + j).applyMatrix4(child.matrixWorld));
      const [a, b, c] = vertices;
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).multiplyScalar(child.matrixWorld.determinant() < 0 ? -1 : 1);
      const area = normal.length() / 2;
      if (!Number.isFinite(area) || area < 1e-10) continue;
      const materialIndex = geometry.groups.find(g => i * 3 >= g.start && i * 3 < g.start + g.count)?.materialIndex ?? 0;
      const material = Array.isArray(child.material) ? child.material[materialIndex] : child.material;
      if (material && (!material.visible || (material.transparent && material.opacity < 0.75))) continue;
      const id = faces.length;
      faces.push({ point: a.clone().add(b).add(c).divideScalar(3), normal: normal.normalize(), area, vertices, neighbors: [], material: materialIndex });
      const keys = vertices.map(vertexKey);
      for (let j = 0; j < 3; j++) {
        const key = [keys[j], keys[(j + 1) % 3]].sort().join("|");
        const adjacent = edges.get(key) ?? [];
        for (const other of adjacent) { faces[id].neighbors.push(other); faces[other].neighbors.push(id); }
        adjacent.push(id); edges.set(key, adjacent);
      }
    }
    const visited = new Uint8Array(faces.length);
    const order = faces.map((_, i) => i).sort((a, b) => faces[b].area - faces[a].area);
    for (const seedId of order) {
      if (visited[seedId]) continue;
      const seed = faces[seedId];
      const queue = [seedId]; visited[seedId] = 1;
      let area = 0;
      const centroid = new THREE.Vector3();
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const face = faces[queue[cursor]];
        area += face.area; centroid.addScaledVector(face.point, face.area);
        for (const id of face.neighbors) {
          const next = faces[id];
          if (visited[id] || next.material !== seed.material || next.normal.dot(face.normal) < 0.94 || next.normal.dot(seed.normal) < 0.82) continue;
          if (Math.abs(next.point.clone().sub(seed.point).dot(seed.normal)) > 0.055) continue;
          visited[id] = 1; queue.push(id);
        }
      }
      if (area < 0.008) continue;
      centroid.divideScalar(area);
      // A centroid can lie in a hole or in empty space. Project it onto an
      // actual member triangle instead of placing the anchor in that hole.
      let best = seed; let bestPoint = seed.point; let distance = Infinity;
      for (const id of queue) {
        const face = faces[id];
        const p = new THREE.Triangle(...face.vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).closestPointToPoint(centroid, new THREE.Vector3());
        const d = p.distanceToSquared(centroid);
        if (d < distance) { distance = d; best = face; bestPoint = p; }
      }
      const alternatives = queue.map(id => faces[id]).sort((a, b) => a.point.distanceToSquared(centroid) - b.point.distanceToSquared(centroid)).slice(0, 16).map(face => ({ point: face.point, normal: face.normal }));
      candidates.push({ point: bestPoint, normal: best.normal, area, alternatives, mesh: child });
    }
  });
  candidates.sort((a, b) => b.area - a.area);
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    if (chosen.length >= MAX_SURFACE_SPOTS) break;
    // Require a small two-dimensional footprint, not just area (long thin
    // rails have area too). Try nearby interior triangles when a region's
    // centroid projects onto the boundary of a hole.
    for (const anchor of [candidate, ...candidate.alternatives]) {
      if (chosen.some(c => c.point.distanceTo(anchor.point) < 0.16)) continue;
      const hit = surfaceHit(root, anchor.point, anchor.normal);
      if (!hit || hit.point.distanceTo(anchor.point) > 0.015) continue;
      const u = new THREE.Vector3(Math.abs(anchor.normal.y) > 0.9 ? 1 : 0, Math.abs(anchor.normal.y) > 0.9 ? 0 : 1, 0).cross(anchor.normal).normalize();
      const v = anchor.normal.clone().cross(u);
      let supported = true;
      for (let x = -1; x <= 1 && supported; x++) for (let y = -1; y <= 1; y++) {
        const sample = anchor.point.clone().addScaledVector(u, x * 0.035).addScaledVector(v, y * 0.025);
        const support = surfaceHit(root, sample, anchor.normal, 0.06);
        const normal = support && hitNormal(support);
        if (!support || support.object !== candidate.mesh || !normal || normal.dot(anchor.normal) < 0.82 || support.point.distanceTo(sample) > 0.04) { supported = false; break; }
      }
      if (!supported) continue;
      chosen.push({ ...candidate, point: anchor.point, normal: anchor.normal });
      break;
    }
  }
  return {
    recommendedCount: Math.min(8, chosen.length),
    usableSideArea: chosen.reduce((sum, c) => sum + c.area, 0),
    warning: limited ? "This model is very detailed. Some surfaces need manual placement." : chosen.length === 0 ? "No large continuous surface was found. Click the model to place your first spot." : undefined,
    placements: chosen.map((c, i) => ({ id: i + 1, region: `Surface ${i + 1}`, position: vectorTuple(c.point), normal: vectorTuple(c.normal) })),
  };
}
