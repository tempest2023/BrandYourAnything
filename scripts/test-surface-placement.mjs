import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { loadTypeScript } from './lib/load-typescript.mjs';
import { loadPreset } from './lib/load-preset-model.mjs';
const overrides = { three: THREE, 'three/examples/jsm/geometries/DecalGeometry.js': { DecalGeometry } };
const { analyzeModelSurface, surfaceHit } = loadTypeScript('lib/surface-analysis.ts', overrides);
const { createSurfaceDecal } = loadTypeScript('lib/surface-decal.ts', overrides);

for (const [id, profile, count] of [['tesla-model-3', 'car', 5], ['tesla-cybertruck', 'car', 5], ['flybridge-yacht', 'yacht', 6], ['private-jet', 'jet', 6]]) {
  test(`${id}: every named region hits the real asset and supports a decal`, async () => {
    const { root } = await loadPreset(id);
    const result = analyzeModelSurface(root, profile, id);
    assert.equal(result.recommendedCount, count);
    assert.ok(result.placements.length >= count);
    for (const spot of result.placements) {
      const point = new THREE.Vector3().fromArray(spot.position), normal = new THREE.Vector3().fromArray(spot.normal);
      const hit = surfaceHit(root, point, normal, 0.05);
      assert.ok(hit && hit.point.distanceTo(point) < 0.0001, spot.region);
      assert.ok(Math.abs(normal.length() - 1) < 1e-6);
      const decal = createSurfaceDecal(root, spot.position, spot.normal, 'Large');
      assert.ok(decal?.index.count > 0, `${id} ${spot.region} needs a real footprint`);
      decal.dispose();
      if (spot.region.includes('door')) {
        assert.ok(Math.abs(spot.position[0]) > 0.45);
        assert.ok(spot.position[1] < 0.1, 'below windows');
      }
      if (spot.region.startsWith('Driver')) assert.ok(spot.position[0] < 0, 'left-hand drive');
      if (spot.region.startsWith('Passenger')) assert.ok(spot.position[0] > 0);
      if (id === 'private-jet' && spot.region.startsWith('Port')) assert.ok(spot.normal[2] > 0);
      if (id === 'private-jet' && spot.region.startsWith('Starboard')) assert.ok(spot.normal[2] < 0);
      if (spot.region.includes('engine')) assert.ok(Math.abs(spot.position[2]) < 0.5, 'engine must not hit wingtip');
      if (spot.region.includes('transom')) assert.ok(spot.position[2] > 1, 'transom must not hit cabin interior');
    }
    const points = result.placements.map(p => p.position.join(','));
    assert.equal(new Set(points).size, points.length);
  });
}

function model(geometry) { return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); }

test('a refrigerator/box discovers six connected faces including top, independently of tessellation', () => {
  for (const segments of [1, 12]) {
    const result = analyzeModelSurface(model(new THREE.BoxGeometry(1, 2, 0.8, segments, segments, segments)), 'generic');
    assert.equal(result.placements.length, 6);
    assert.ok(result.placements.some(p => p.normal[1] > 0.99));
    assert.ok(result.placements.some(p => p.normal[1] < -0.99));
    assert.ok(Math.abs(result.usableSideArea - 8.8) < 1e-5);
  }
});

test('disconnected coplanar surfaces are not merged into a floating centroid', () => {
  const root = new THREE.Group();
  for (const x of [-0.8, 0.8]) { const panel = model(new THREE.PlaneGeometry(0.5, 1, 8, 8)); panel.position.x = x; root.add(panel); }
  const result = analyzeModelSurface(root, 'generic');
  assert.equal(result.placements.length, 2);
  assert.ok(result.placements.every(p => Math.abs(p.position[0]) > 0.5));
});

test('curved surfaces produce distinct real anchors and no invented minimum count', () => {
  const root = model(new THREE.SphereGeometry(1, 32, 24));
  const result = analyzeModelSurface(root, 'generic');
  assert.ok(result.placements.length > 1);
  for (const p of result.placements) assert.ok(Math.abs(new THREE.Vector3(...p.position).length() - 1) < 0.02);
  const empty = analyzeModelSurface(new THREE.Group(), 'generic');
  assert.equal(empty.placements.length, 0);
  assert.equal(empty.recommendedCount, 0);
});

test('world transforms and meshes without vertex normals still support placement', () => {
  const geometry = new THREE.PlaneGeometry(1, 1); geometry.deleteAttribute('normal');
  const root = model(geometry); root.rotation.x = -Math.PI / 2; root.position.set(0.2, 0.6, -0.1);
  const analysis = analyzeModelSurface(root, 'generic');
  assert.equal(analysis.placements.length, 1);
  const p = analysis.placements[0];
  assert.ok(Math.abs(p.position[1] - 0.6) < 1e-6);
  assert.ok(p.normal[1] > 0.99);
  const decal = createSurfaceDecal(root, p.position, p.normal);
  assert.ok(decal?.index.count); decal.dispose();
});

test('hidden and transparent geometry does not become a recommended advertisement region', () => {
  const root = new THREE.Group();
  const hidden = model(new THREE.BoxGeometry()); hidden.visible = false; root.add(hidden);
  const glass = model(new THREE.PlaneGeometry()); glass.material.transparent = true; glass.material.opacity = 0.2; root.add(glass);
  assert.equal(analyzeModelSurface(root, 'generic').placements.length, 0);
});

test('thin rails are rejected even when their total area is large', () => {
  const result = analyzeModelSurface(model(new THREE.PlaneGeometry(2.8, 0.01, 20, 1)), 'generic');
  assert.equal(result.placements.length, 0);
});

test('a region with a central hole chooses a supported interior rather than the hole', () => {
  const shape = new THREE.Shape();
  shape.moveTo(-1, -1); shape.lineTo(1, -1); shape.lineTo(1, 1); shape.lineTo(-1, 1); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.3, -0.3); hole.lineTo(-0.3, 0.3); hole.lineTo(0.3, 0.3); hole.lineTo(0.3, -0.3); hole.closePath();
  shape.holes.push(hole);
  const result = analyzeModelSurface(model(new THREE.ShapeGeometry(shape)), 'generic');
  assert.ok(result.placements.length > 0);
  assert.ok(result.placements.every(p => Math.abs(p.position[0]) > 0.33 || Math.abs(p.position[1]) > 0.33));
});

test('reflected objects preserve exterior normals', () => {
  const root = model(new THREE.BoxGeometry()); root.scale.x = -1;
  const result = analyzeModelSurface(root, 'generic');
  assert.equal(result.placements.length, 6);
  for (const p of result.placements) assert.ok(new THREE.Vector3(...p.position).dot(new THREE.Vector3(...p.normal)) > 0);
});
