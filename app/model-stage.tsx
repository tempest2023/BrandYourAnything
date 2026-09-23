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
  type SurfaceModelAnalysis,
  type SurfacePlacementProfile,
  type SurfaceSpotPlacement,
  type SurfaceVector,
} from "@/lib/surface-spots";
import { createSurfaceDecal } from "@/lib/surface-decal";
import { analyzeModelSurface, prepareSurfaceRaycasting, hitNormal, vectorTuple } from "@/lib/surface-analysis";
import { getPresetModelFromPublicPath } from "@/lib/preset-models";
import styles from "./model-stage.module.css";
import { useI18n } from "@/app/i18n-provider";

export type ModelStageSpot = {
  id: number;
  size?: string;
  holder?: string;
  bids?: number;
  disabled?: boolean;
  position?: SurfaceVector;
  normal?: SurfaceVector;
};

type ModelStageProps = {
  sourceUrl: string;
  sourceKey?: string;
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

export function ModelStage({
  sourceUrl,
  sourceKey,
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
  const suppressMarkerClickRef = useRef(false);
  const dragSpotRef = useRef<((event: PointerEvent, id: number) => void) | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<number, HTMLButtonElement>());
  const spotsRef = useRef(spots);
  const selectedSpotIdRef = useRef(selectedSpotId);
  const editingRef = useRef(editing);
  const onModelAnalysisRef = useRef(onModelAnalysis);
  const onPlaceSpotRef = useRef(onPlaceSpot);
  const onPlacementErrorRef = useRef(onPlacementError);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const { t } = useI18n();
  const [retry, setRetry] = useState(0);
  const sourceUrlRef = useRef(sourceUrl);
  const sourceIdentity = sourceKey ?? sourceUrl;
  const resolvedFormat = format || getBrandModelFormat(sourceUrl) || "glb";
  useEffect(() => { sourceUrlRef.current = sourceUrl; }, [sourceUrl]);

  useEffect(() => { spotsRef.current = spots; }, [spots]);
  useEffect(() => { selectedSpotIdRef.current = selectedSpotId; }, [selectedSpotId]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { onModelAnalysisRef.current = onModelAnalysis; }, [onModelAnalysis]);
  useEffect(() => { onPlaceSpotRef.current = onPlaceSpot; }, [onPlaceSpot]);
  useEffect(() => { onPlacementErrorRef.current = onPlacementError; }, [onPlacementError]);

  useEffect(() => {
    const mount = mountRef.current;
    const sourceUrl = sourceUrlRef.current;
    if (!mount || !sourceUrl) return;

    let disposed = false;
    let frame = 0;
    let modelRoot: THREE.Object3D | null = null;
    let normalizedRoot: THREE.Group | null = null;

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
      (loadedRoot) => {
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

        prepareSurfaceRaycasting(normalizedRoot);
        onModelAnalysisRef.current?.(analyzeModelSurface(normalizedRoot, placementProfile, getPresetModelFromPublicPath(sourceUrl)?.id));
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
    raycaster.firstHitOnly = true;
    const pointer = new THREE.Vector2();
    let dragId: number | null = null;
    let dragPointer: number | null = null;
    let pendingPlacement: SurfaceSpotPlacement | null = null;
    const placeAtPointer = (event: PointerEvent, id: number) => {
      if (!normalizedRoot) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(normalizedRoot, true)[0];
      const normal = hit && hitNormal(hit);
      if (!hit || !normal) return null;
      // Face the visible side of an open/two-sided scan, not the object centre.
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
      return { id, position: vectorTuple(hit.point), normal: vectorTuple(normal) };
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerStart.set(event.clientX, event.clientY);
      controls.autoRotate = false;
    };
    dragSpotRef.current = (event, id) => {
      if (!editingRef.current || event.button !== 0) return;
      suppressMarkerClickRef.current = false;
      dragId = id;
      dragPointer = event.pointerId;
      pointerStart.set(event.clientX, event.clientY);
      controls.enabled = false;
      controls.autoRotate = false;
      pendingPlacement = null;
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragId === null || event.pointerId !== dragPointer) return;
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 4) return;
      suppressMarkerClickRef.current = true;
      pendingPlacement = placeAtPointer(event, dragId);
    };
    const endDrag = () => {
      dragId = null; dragPointer = null; pendingPlacement = null; controls.enabled = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (dragId !== null) {
        if (event.pointerId !== dragPointer) return;
        if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >= 4) {
          const placement = placeAtPointer(event, dragId);
          if (placement) onPlaceSpotRef.current?.(placement);
          else onPlacementErrorRef.current?.("Drop the spot on the model. Its previous position was kept.");
        }
        endDrag();
        return;
      }
      if (event.target !== renderer.domElement || !editingRef.current || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const id = selectedSpotIdRef.current ?? spotsRef.current[0]?.id ?? 1;
      const placement = placeAtPointer(event, id);
      if (placement) onPlaceSpotRef.current?.(placement);
    };
    const cancelDrag = () => endDrag();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("blur", cancelDrag);

    const decals = new THREE.Group();
    scene.add(decals);
    const decalCache = new Map<number, { signature: string; mesh: THREE.Mesh | null }>();
    const clearDecals = () => {
      decalCache.clear();
      for (const object of [...decals.children]) {
        const mesh = object as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        decals.remove(mesh);
      }
    };
    const timer = new THREE.Timer();
    timer.connect(document);
    const projected = new THREE.Vector3();
    const cameraToPoint = new THREE.Vector3();
    let focusSignature = "";
    const render = (timestamp: number) => {
      frame = window.requestAnimationFrame(render);
      timer.update(timestamp);
      const delta = Math.min(timer.getDelta(), 0.05);

      if (editingRef.current) controls.autoRotate = false;
      const selected = spotsRef.current.find(spot => spot.id === selectedSpotIdRef.current);
      const nextFocus = JSON.stringify([selected?.id, selected?.position]);
      if (nextFocus !== focusSignature && dragId === null && selected?.position && selected.normal) {
        const point = new THREE.Vector3().fromArray(selected.position);
        const normal = new THREE.Vector3().fromArray(selected.normal);
        if (camera.position.clone().sub(point).normalize().dot(normal) < 0.35) {
          camera.position.copy(point).addScaledVector(normal, 4);
          if (Math.abs(normal.y) < 0.8) camera.position.y += 0.8;
          camera.lookAt(controls.target);
        }
        focusSignature = nextFocus;
      }
      controls.update(delta);
      const displayedSpots = spotsRef.current.map(spot => pendingPlacement?.id === spot.id ? { ...spot, ...pendingPlacement } : spot);
      if (normalizedRoot) {
        for (const [id, cached] of decalCache) {
          if (displayedSpots.some(spot => spot.id === id)) continue;
          if (cached.mesh) { decals.remove(cached.mesh); cached.mesh.geometry.dispose(); (cached.mesh.material as THREE.Material).dispose(); }
          decalCache.delete(id);
        }
        for (const spot of displayedSpots) {
          const signature = JSON.stringify([spot.position, spot.normal, spot.size]);
          const cached = decalCache.get(spot.id);
          if (cached?.signature !== signature) {
            if (cached?.mesh) { decals.remove(cached.mesh); cached.mesh.geometry.dispose(); (cached.mesh.material as THREE.Material).dispose(); }
            const geometry = spot.position && spot.normal ? createSurfaceDecal(normalizedRoot, spot.position, spot.normal, spot.size) : null;
            const mesh = geometry ? new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })) : null;
            if (mesh) { mesh.renderOrder = 2; decals.add(mesh); }
            decalCache.set(spot.id, { signature, mesh });
          }
          const mesh = decalCache.get(spot.id)?.mesh;
          if (mesh) (mesh.material as THREE.MeshBasicMaterial).color.setHex(spot.id === selectedSpotIdRef.current ? 0xf47c45 : 0xecc85b);
        }
      }
      renderer.render(scene, camera);

      const width = mount.clientWidth;
      const height = mount.clientHeight;
      for (const spot of displayedSpots) {
        const marker = markerRefs.current.get(spot.id);
        if (!marker) continue;
        if (!spot.position) { marker.style.visibility = "hidden"; continue; }
        projected.fromArray(spot.position).project(camera);
        const normal = spot.normal ? new THREE.Vector3().fromArray(spot.normal) : null;
        const point = new THREE.Vector3().fromArray(spot.position);
        const facing = !normal || cameraToPoint.subVectors(camera.position, point).dot(normal) > -0.02;
        const direction = point.clone().sub(camera.position);
        const distance = direction.length();
        raycaster.set(camera.position, direction.normalize());
        const obstruction = normalizedRoot ? raycaster.intersectObject(normalizedRoot, true)[0] : null;
        const visible = facing && projected.z > -1 && projected.z < 1 && (!obstruction || obstruction.distance >= distance - 0.015);
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
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      dragSpotRef.current = null;
      clearDecals();
      controls.dispose();

      if (modelRoot) {
        modelRoot.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.boundsTree = undefined;
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach(disposeMaterial);
          else if (child.material) disposeMaterial(child.material);
        });
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [placementProfile, resolvedFormat, sourceIdentity, retry]);

  return (
    <div className={`${styles.stage} ${editing ? styles.editing : ""} ${className}`} role={editing || onSelectSpot ? "group" : "img"} aria-label={label}>
      <div ref={mountRef} className={styles.canvas} />
      {status === "loading" && <div className={styles.status}><span />Preparing your model…</div>}
      {status === "error" && (
        <div className={styles.error} role="status">
          <strong>This {resolvedFormat.toUpperCase()} model could not be previewed.</strong>
          <span>Use one self-contained file without missing textures or companion files.</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>{t("laptop.retryModel")}</button>
        </div>
      )}
      {status === "ready" && (
        <span className={styles.orbitHint}>{editing ? "Drag a number to move it · drag the model to orbit" : "Drag to orbit · scroll to zoom"}</span>
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
            disabled={spot.disabled || !onSelectSpot}
            className={`${styles.marker} ${claimed ? styles.claimed : ""} ${selectedSpotId === spot.id ? styles.selected : ""}`}
            style={spot.position ? { visibility: status === "ready" ? undefined : "hidden" } : { visibility: "hidden", left: `${fallback[0]}%`, top: `${fallback[1]}%` }}
            onPointerDown={(event) => {
              onSelectSpot?.(spot.id);
              dragSpotRef.current?.(event.nativeEvent, spot.id);
            }}
            onClick={() => {
              if (suppressMarkerClickRef.current) { suppressMarkerClickRef.current = false; return; }
              onSelectSpot?.(spot.id);
            }}
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
