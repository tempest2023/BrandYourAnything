"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { getBrandModelFormat, type BrandModelFormat } from "@/lib/brand-model";
import {
  MAX_SURFACE_SPOTS,
  RECOMMENDED_SURFACE_SPOTS,
  type SurfaceModelAnalysis,
  type SurfacePlacementProfile,
  type SurfaceSpotPlacement,
  type SurfaceVector,
} from "@/lib/surface-spots";
import styles from "./model-stage.module.css";

export type ModelStageSpot = {
  id: number;
  holder?: string;
  bids?: number;
  position?: SurfaceVector;
  normal?: SurfaceVector;
};

type ModelStageProps = {
  sourceUrl: string;
  format?: BrandModelFormat;
  label: string;
  className?: string;
  spots?: ModelStageSpot[];
  selectedSpotId?: number;
  onSelectSpot?: (spotId: number) => void;
  placementProfile?: SurfacePlacementProfile;
  editing?: boolean;
  onModelAnalysis?: (analysis: SurfaceModelAnalysis) => void;
  onPlaceSpot?: (spot: SurfaceSpotPlacement) => void;
  onPlacementError?: (message: string) => void;
};

type SurfaceCandidate = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  area: number;
};

const MARKER_POSITIONS = [
  [18, 24], [50, 13], [82, 24], [10, 49], [36, 42],
  [64, 42], [90, 49], [21, 76], [50, 83], [79, 76],
] as const;

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function meshFromGeometry(geometry: THREE.BufferGeometry) {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xd9d5ca,
    metalness: 0.08,
    roughness: 0.58,
    side: THREE.DoubleSide,
    vertexColors: Boolean(geometry.getAttribute("color")),
  });
  return new THREE.Mesh(geometry, material);
}

function loadModelSource(
  sourceUrl: string,
  format: BrandModelFormat,
  onLoad: (root: THREE.Object3D, animations?: THREE.AnimationClip[]) => void,
  onError: () => void,
) {
  if (format === "glb" || format === "gltf") {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(sourceUrl, (gltf) => onLoad(gltf.scene, gltf.animations), undefined, onError);
    return;
  }
  if (format === "fbx") {
    new FBXLoader().load(sourceUrl, (group) => onLoad(group, group.animations), undefined, onError);
    return;
  }
  if (format === "obj") {
    new OBJLoader().load(sourceUrl, (group) => onLoad(group), undefined, onError);
    return;
  }
  if (format === "stl") {
    new STLLoader().load(sourceUrl, (geometry) => onLoad(meshFromGeometry(geometry)), undefined, onError);
    return;
  }
  new PLYLoader().load(sourceUrl, (geometry) => onLoad(meshFromGeometry(geometry)), undefined, onError);
}

function vectorTuple(vector: THREE.Vector3): SurfaceVector {
  return [
    Number(vector.x.toFixed(5)),
    Number(vector.y.toFixed(5)),
    Number(vector.z.toFixed(5)),
  ];
}

function pointDistance(a: THREE.Vector3, b: THREE.Vector3, size: THREE.Vector3) {
  const dx = (a.x - b.x) / Math.max(size.x, 0.01);
  const dy = (a.y - b.y) / Math.max(size.y, 0.01);
  const dz = (a.z - b.z) / Math.max(size.z, 0.01);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function profileTargets(profile: SurfacePlacementProfile) {
  if (profile === "car") {
    return [
      { length: 0.4, side: 0, end: 0, up: true, height: -0.18 },
      { length: -0.17, side: -1, end: 0, height: 0 },
      { length: -0.17, side: 1, end: 0, height: 0 },
      { length: 0.2, side: -1, end: 0, height: 0 },
      { length: 0.2, side: 1, end: 0, height: 0 },
    ];
  }
  if (profile === "yacht") {
    return [
      { length: 0, side: -1, end: 0, height: -0.08 },
      { length: 0, side: 1, end: 0, height: -0.08 },
      { length: 0, side: -1, end: 0, height: 0.2 },
      { length: 0, side: 1, end: 0, height: 0.2 },
      { length: -0.46, side: 0, end: -1, height: 0 },
      { length: 0.46, side: 0, end: 1, height: 0 },
    ];
  }
  if (profile === "jet") {
    return [
      { length: -0.18, side: -1, end: 0, height: 0 },
      { length: -0.18, side: 1, end: 0, height: 0 },
      { length: 0.08, side: -1, end: 0, height: -0.08 },
      { length: 0.08, side: 1, end: 0, height: -0.08 },
      { length: 0.36, side: -1, end: 0, height: 0.14 },
      { length: 0.36, side: 1, end: 0, height: 0.14 },
    ];
  }
  return [];
}

function analyzeModelSurface(root: THREE.Object3D, profile: SurfacePlacementProfile): SurfaceModelAnalysis {
  root.updateMatrixWorld(true);
  const candidates: SurfaceCandidate[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let usableSideArea = 0;

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const triangleCount = Math.floor((index?.count ?? positions.count) / 3);
    const stride = Math.max(1, Math.ceil(triangleCount / 5000));

    for (let triangle = 0; triangle < triangleCount; triangle += stride) {
      const offset = triangle * 3;
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(positions, ia).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(positions, ib).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(positions, ic).applyMatrix4(child.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const cross = ab.clone().cross(ac);
      const area = cross.length() * 0.5 * stride;
      if (!Number.isFinite(area) || area < 0.000001) continue;
      const normal = cross.normalize();
      const isCarHoodCandidate = profile === "car" && normal.y > 0.72;
      if (Math.abs(normal.y) >= 0.72 && !isCarHoodCandidate) continue;
      const point = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      usableSideArea += area;
      candidates.push({ point, normal, area });
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  for (const candidate of candidates) {
    if (candidate.point.clone().sub(center).dot(candidate.normal) < 0) candidate.normal.multiplyScalar(-1);
  }
  if (candidates.length === 0) {
    const fallback: SurfaceSpotPlacement[] = Array.from({ length: MAX_SURFACE_SPOTS }, (_, index) => {
      const angle = (index / MAX_SURFACE_SPOTS) * Math.PI * 2;
      const normal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const point = center.clone().add(new THREE.Vector3(
        normal.x * size.x * 0.5,
        ((index % 3) - 1) * size.y * 0.2,
        normal.z * size.z * 0.5,
      ));
      return { id: index + 1, position: vectorTuple(point), normal: vectorTuple(normal) };
    });
    return { recommendedCount: RECOMMENDED_SURFACE_SPOTS[profile], usableSideArea: 0, placements: fallback };
  }

  const lengthIsX = size.x >= size.z;
  const chosen: SurfaceCandidate[] = [];
  const available = new Set(candidates);
  const targets = profileTargets(profile);
  for (const target of targets) {
    let best: SurfaceCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of available) {
      const lengthValue = lengthIsX ? candidate.point.x : candidate.point.z;
      const sideValue = lengthIsX ? candidate.point.z : candidate.point.x;
      const lengthNormal = lengthIsX ? candidate.normal.x : candidate.normal.z;
      const sideNormal = lengthIsX ? candidate.normal.z : candidate.normal.x;
      const normalizedLength = (lengthValue - (lengthIsX ? center.x : center.z)) / Math.max(lengthIsX ? size.x : size.z, 0.01);
      const normalizedSide = (sideValue - (lengthIsX ? center.z : center.x)) / Math.max(lengthIsX ? size.z : size.x, 0.01);
      const normalizedHeight = (candidate.point.y - center.y) / Math.max(size.y, 0.01);
      const desiredNormal = target.up ? candidate.normal.y : target.end ? lengthNormal * target.end : sideNormal * target.side;
      const score = Math.abs(normalizedLength - target.length)
        + Math.abs(normalizedSide - target.side * 0.48) * 0.7
        + Math.abs(normalizedHeight - target.height) * 0.35
        + Math.max(0, 0.65 - desiredNormal) * 1.6;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) {
      chosen.push(best);
      available.delete(best);
    }
  }

  if (chosen.length === 0) {
    const first = candidates.reduce((best, candidate) => candidate.area > best.area ? candidate : best);
    chosen.push(first);
    available.delete(first);
  }
  while (chosen.length < MAX_SURFACE_SPOTS && available.size > 0) {
    let best: SurfaceCandidate | null = null;
    let bestScore = -1;
    for (const candidate of available) {
      const separation = Math.min(...chosen.map((item) => pointDistance(candidate.point, item.point, size)));
      const score = separation + Math.min(candidate.area / Math.max(usableSideArea, 0.001), 0.04);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    available.delete(best);
  }

  const sideBoxArea = Math.max(0.001, 2 * size.y * (size.x + size.z));
  const genericCount = Math.min(12, Math.max(6, Math.round(6 + Math.min(3, usableSideArea / sideBoxArea))));
  return {
    recommendedCount: profile === "generic" ? genericCount : RECOMMENDED_SURFACE_SPOTS[profile],
    usableSideArea: Number(usableSideArea.toFixed(3)),
    placements: chosen.slice(0, MAX_SURFACE_SPOTS).map((candidate, index) => ({
      id: index + 1,
      position: vectorTuple(candidate.point.clone().addScaledVector(candidate.normal, 0.035)),
      normal: vectorTuple(candidate.normal),
    })),
  };
}

export function ModelStage({
  sourceUrl,
  format,
  label,
  className = "",
  spots = [],
  selectedSpotId,
  onSelectSpot,
  placementProfile = "generic",
  editing = false,
  onModelAnalysis,
  onPlaceSpot,
  onPlacementError,
}: ModelStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<number, HTMLButtonElement>());
  const spotsRef = useRef(spots);
  const selectedSpotIdRef = useRef(selectedSpotId);
  const editingRef = useRef(editing);
  const onModelAnalysisRef = useRef(onModelAnalysis);
  const onPlaceSpotRef = useRef(onPlaceSpot);
  const onPlacementErrorRef = useRef(onPlacementError);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const resolvedFormat = format || getBrandModelFormat(sourceUrl) || "glb";

  useEffect(() => { spotsRef.current = spots; }, [spots]);
  useEffect(() => { selectedSpotIdRef.current = selectedSpotId; }, [selectedSpotId]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { onModelAnalysisRef.current = onModelAnalysis; }, [onModelAnalysis]);
  useEffect(() => { onPlaceSpotRef.current = onPlaceSpot; }, [onPlaceSpot]);
  useEffect(() => { onPlacementErrorRef.current = onPlacementError; }, [onPlacementError]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !sourceUrl) return;

    let disposed = false;
    let frame = 0;
    let modelRoot: THREE.Object3D | null = null;
    let normalizedRoot: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(3.4, 2.2, 4.8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      queueMicrotask(() => setStatus("error"));
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.minDistance = 2.3;
    controls.maxDistance = 8;
    controls.autoRotate = !editingRef.current;
    controls.autoRotateSpeed = 0.55;

    scene.add(new THREE.HemisphereLight(0xfff8eb, 0x324458, 2.6));
    const key = new THREE.DirectionalLight(0xfff1d6, 4.8);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2ff, 2.4);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    queueMicrotask(() => {
      if (!disposed) setStatus("loading");
    });
    loadModelSource(
      sourceUrl,
      resolvedFormat,
      (loadedRoot, animations = []) => {
        if (disposed) return;
        modelRoot = loadedRoot;
        modelRoot.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.castShadow = false;
          child.receiveShadow = false;
          if (Array.isArray(child.material)) child.material = child.material.map((material) => material.clone());
          else if (child.material) child.material = child.material.clone();
        });

        normalizedRoot = new THREE.Group();
        normalizedRoot.add(modelRoot);
        const box = new THREE.Box3().setFromObject(normalizedRoot);
        if (box.isEmpty()) {
          setStatus("error");
          return;
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const largest = Math.max(size.x, size.y, size.z);
        const scale = largest > 0 ? 2.8 / largest : 1;
        normalizedRoot.position.copy(center).multiplyScalar(-scale);
        normalizedRoot.scale.setScalar(scale);
        scene.add(normalizedRoot);
        normalizedRoot.updateMatrixWorld(true);

        const scaledCenterY = (size.y * scale) * 0.05;
        controls.target.set(0, scaledCenterY, 0);
        camera.position.set(3.5, Math.max(1.8, size.y * scale * 0.7), 4.7);
        camera.lookAt(controls.target);
        controls.update();

        if (animations.length > 0) {
          mixer = new THREE.AnimationMixer(modelRoot);
          mixer.clipAction(animations[0]).play();
        }
        onModelAnalysisRef.current?.(analyzeModelSurface(normalizedRoot, placementProfile));
        setStatus("ready");
      },
      () => {
        if (!disposed) setStatus("error");
      },
    );

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const pointerStart = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      pointerStart.set(event.clientX, event.clientY);
      controls.autoRotate = false;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!editingRef.current || !normalizedRoot || !onPlaceSpotRef.current) return;
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const selectedId = selectedSpotIdRef.current ?? spotsRef.current[0]?.id;
      if (!selectedId) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(normalizedRoot, true)[0];
      if (!hit?.face) return;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      if (hit.point.dot(normal) < 0) normal.multiplyScalar(-1);
      const isCarHood = placementProfile === "car" && normal.y > 0.72;
      if (Math.abs(normal.y) >= 0.72 && !isCarHood) {
        onPlacementErrorRef.current?.(placementProfile === "car"
          ? "Choose an outward-facing surface — the underside is excluded."
          : "Choose a side surface — top and bottom faces are excluded.");
        return;
      }
      onPlaceSpotRef.current({
        id: selectedId,
        position: vectorTuple(hit.point.clone().addScaledVector(normal, 0.035)),
        normal: vectorTuple(normal),
      });
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const timer = new THREE.Timer();
    timer.connect(document);
    const projected = new THREE.Vector3();
    const cameraToPoint = new THREE.Vector3();
    const render = (timestamp: number) => {
      frame = window.requestAnimationFrame(render);
      timer.update(timestamp);
      const delta = Math.min(timer.getDelta(), 0.05);
      mixer?.update(delta);
      controls.update(delta);
      renderer.render(scene, camera);

      const width = mount.clientWidth;
      const height = mount.clientHeight;
      for (const spot of spotsRef.current) {
        const marker = markerRefs.current.get(spot.id);
        if (!marker || !spot.position) continue;
        projected.fromArray(spot.position).project(camera);
        const normal = spot.normal ? new THREE.Vector3().fromArray(spot.normal) : null;
        const point = new THREE.Vector3().fromArray(spot.position);
        const facing = !normal || cameraToPoint.subVectors(camera.position, point).dot(normal) > -0.02;
        const visible = facing && projected.z > -1 && projected.z < 1;
        marker.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        marker.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
        marker.style.visibility = visible ? "visible" : "hidden";
      }
    };
    render(performance.now());

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      timer.dispose();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      mixer?.stopAllAction();
      if (modelRoot) {
        modelRoot.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach(disposeMaterial);
          else if (child.material) disposeMaterial(child.material);
        });
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [placementProfile, resolvedFormat, sourceUrl]);

  return (
    <div className={`${styles.stage} ${editing ? styles.editing : ""} ${className}`} role={editing ? "group" : "img"} aria-label={label}>
      <div ref={mountRef} className={styles.canvas} />
      {status === "loading" && <div className={styles.status}><span />Preparing your model…</div>}
      {status === "error" && (
        <div className={styles.error} role="status">
          <strong>This {resolvedFormat.toUpperCase()} model could not be previewed.</strong>
          <span>Use one self-contained file without missing textures or companion files.</span>
        </div>
      )}
      {status === "ready" && (
        <span className={styles.orbitHint}>{editing ? "Select a spot, then click an eligible surface" : "Drag to orbit · scroll to zoom"}</span>
      )}
      {spots.map((spot, index) => {
        const fallback = MARKER_POSITIONS[index % MARKER_POSITIONS.length];
        const claimed = (spot.bids ?? 0) > 0;
        return (
          <button
            key={spot.id}
            ref={(node) => {
              if (node) markerRefs.current.set(spot.id, node);
              else markerRefs.current.delete(spot.id);
            }}
            type="button"
            className={`${styles.marker} ${claimed ? styles.claimed : ""} ${selectedSpotId === spot.id ? styles.selected : ""}`}
            style={spot.position ? undefined : { left: `${fallback[0]}%`, top: `${fallback[1]}%` }}
            onClick={() => onSelectSpot?.(spot.id)}
            aria-label={claimed ? `Spot ${spot.id}, held by ${spot.holder}` : `Spot ${spot.id}, available`}
            aria-pressed={selectedSpotId === spot.id}
          >
            {String(spot.id).padStart(2, "0")}
          </button>
        );
      })}
    </div>
  );
}
