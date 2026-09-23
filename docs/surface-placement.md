# Surface placement design and research

## What changed

The old algorithm sampled individual triangles, guessed the vehicle's longitudinal axis from its bounding box, flipped normals relative to the object centre, and offset floating HTML markers from the mesh. It did not identify connected advertising panels. Selecting a region changed only its name. Exhausted recommendations were silently repeated or replaced with the origin.

The new path uses two sources of recommendations:

- **Bundled presets:** `lib/preset-surfaces.ts` calibrates each asset in the existing normalized coordinate system (largest bounding-box dimension = 2.8). Each named region has its own target and outward projection direction. Engines use short projection rays to exclude winglets; the yacht transom avoids the open centre of the stern. Preset GLBs must be recalibrated if replaced. Glass roofs, windows, wheels and wings are not automatic car/aircraft recommendations. Additional spots beyond the curated inventory require manual placement.
- **Uploads:** `lib/surface-analysis.ts` welds positional edge keys across UV seams within each mesh, builds triangle adjacency, and grows connected regions. It stops at material boundaries, local bends (~20 degrees), cumulative normal changes (~35 degrees), or a 0.055-unit seed-plane distance. It sums real triangle areas, rejects tiny regions, sorts by area, projects candidate anchors onto actual member triangles, verifies exterior visibility and a small 2D support footprint, and tries nearby triangle interiors when the centroid falls in a hole. All orientations, including top/bottom faces, are eligible. It returns only real recommendations, including zero when none qualify.

The use of shared-edge connectivity is deliberate: disconnected panels on the same plane must never be joined into an advertisement floating between them. Both seed-relative and neighbor-relative curvature limits prevent a flood fill from walking all the way around a curved object.

## Interaction and rendering

Choose the spot count and a named suggested region. Region selection moves the corresponding 3D anchor, and selecting a hidden spot brings that side into view. Existing occupied region anchors cannot be assigned twice. Extra spots remain visibly unplaced and block continuation until positioned. Reset restores calibrated/detected recommendations.

Drag a numbered marker to move it; drag the model to orbit. Clicking a surface is an alternative to dragging and can place an initially unplaced spot. Pointer capture, cancellation and invalid drops preserve the previous saved position. Undo restores the last accepted move and its region label. Manual moves are labeled as a custom exterior surface rather than retaining a misleading vehicle-part name.

`lib/surface-decal.ts` projects real clipped geometry onto the selected mesh. S/M/L change the preview footprint; it samples support and shrinks near boundaries, holes and strong bends. Reflected transforms retain correct triangle winding. The HTML numbers are handles, and are hidden when occluded; the colored patch is the placement preview. The saved position is on the mesh, with no artificial 0.035-unit offset. Existing position/normal and S/M/L persistence remains compatible with published auctions.

A per-mesh BVH accelerates surface queries, without globally replacing Three.js prototypes or reordering source triangle indices. Decals are cached by position/normal/size so changing a selection does not rebuild every patch. Imported animation clips do not play: placements currently refer to the static model rather than following animated deformation.

## Limits and calibration

This is a deterministic geometric recommendation algorithm, not semantic recognition. It cannot tell that a textured polygon represents a window, a logo, skin, a protected marking or a paintable panel. Transparent materials are excluded from upload recommendations, but opaque textures can still depict glass. Custom models require owner review; manual placement is intentionally flexible.

The normal/plane tolerances allow gently curved regions such as a torso or curved appliance shell, but do not certify fabrication feasibility or distortion of a printed wrap. The surface preview is not a centimetre measurement and no longer claims an exact percentage of an inferred region. Physical dimensions and artwork still need agreement with the winner.

Meshes beyond the 250,000-triangle analysis budget are omitted from automatic segmentation with an explicit manual-placement message. Raycasting remains available. Analysis currently runs on the main thread; a worker is a future performance improvement for very detailed scans. Boundaries are sampled conservatively, not mathematically certified; self-intersections, inconsistent winding, dense overlapping shells and highly concave regions can reduce recommendations. Close, similarly facing anchors are rejected during manual moves, but this is not full pairwise decal-overlap certification. Skeletal/morph animation tracking is not supported.

## Sources

- [CGAL Shape Detection manual](https://doc.cgal.org/latest/Shape_detection/index.html): region growing and connectivity; explains why plain shape fitting alone can group disconnected support. This implementation is inspired by its constraints, not a port of CGAL's least-squares implementation.
- [CGAL least-squares plane region](https://doc.cgal.org/6.1/Shape_detection/classCGAL_1_1Shape__detection_1_1Polygon__mesh_1_1Least__squares__plane__fit__region.html): distance and normal criteria for polygon-mesh region growth.
- [Three.js DecalGeometry](https://threejs.org/docs/pages/DecalGeometry.html): mesh projection with position, orientation and projector size.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh): accelerated raycasting and indirect BVH construction.

## Validation

`npm run test:surface-core` loads the four actual GLBs and checks every curated anchor and decal, plus box/refrigerator faces, tessellation invariance, disconnected planes, curved surfaces, empty models, transformed geometry and missing normals. Fixture loading strips textures/materials only to run geometry checks in Node; visual inspection uses the original assets.

With a local app running, `SURFACE_E2E_URL=http://127.0.0.1:3000 npm run test:surface-browser` exercises the real creation page without publishing: all presets, region placement, excess inventory, dragging, invalid drops, draft reload and mobile overflow. Run `npm run typecheck` and `npm run lint` as well.
