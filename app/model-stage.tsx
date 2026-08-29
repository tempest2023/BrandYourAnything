"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import styles from "./model-stage.module.css";

export type ModelStageSpot = {
  id: number;
  holder?: string;
  bids?: number;
};

type ModelStageProps = {
  sourceUrl: string;
  label: string;
  className?: string;
  spots?: ModelStageSpot[];
  selectedSpotId?: number;
  onSelectSpot?: (spotId: number) => void;
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

export function ModelStage({
  sourceUrl,
  label,
  className = "",
  spots = [],
  selectedSpotId,
  onSelectSpot,
}: ModelStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !sourceUrl) return;

    let disposed = false;
    let frame = 0;
    let modelRoot: THREE.Object3D | null = null;
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
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;

    scene.add(new THREE.HemisphereLight(0xfff8eb, 0x324458, 2.6));
    const key = new THREE.DirectionalLight(0xfff1d6, 4.8);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2ff, 2.4);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    const loader = new GLTFLoader();
    queueMicrotask(() => {
      if (!disposed) setStatus("loading");
    });
    loader.load(
      sourceUrl,
      (gltf) => {
        if (disposed) return;
        modelRoot = gltf.scene;
        modelRoot.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.castShadow = false;
          child.receiveShadow = false;
          if (Array.isArray(child.material)) child.material = child.material.map((material) => material.clone());
          else if (child.material) child.material = child.material.clone();
        });

        const box = new THREE.Box3().setFromObject(modelRoot);
        if (box.isEmpty()) {
          setStatus("error");
          return;
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const largest = Math.max(size.x, size.y, size.z);
        const scale = largest > 0 ? 2.8 / largest : 1;
        modelRoot.position.sub(center);
        modelRoot.scale.setScalar(scale);
        scene.add(modelRoot);

        const scaledCenterY = (size.y * scale) * 0.05;
        controls.target.set(0, scaledCenterY, 0);
        camera.position.set(3.5, Math.max(1.8, size.y * scale * 0.7), 4.7);
        camera.lookAt(controls.target);
        controls.update();

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(modelRoot);
          mixer.clipAction(gltf.animations[0]).play();
        }
        setStatus("ready");
      },
      undefined,
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

    const timer = new THREE.Timer();
    timer.connect(document);
    const render = (timestamp: number) => {
      frame = window.requestAnimationFrame(render);
      timer.update(timestamp);
      const delta = Math.min(timer.getDelta(), 0.05);
      mixer?.update(delta);
      controls.update(delta);
      renderer.render(scene, camera);
    };
    render(performance.now());

    const stopAutoRotate = () => {
      controls.autoRotate = false;
    };
    renderer.domElement.addEventListener("pointerdown", stopAutoRotate, { once: true });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      timer.dispose();
      resizeObserver.disconnect();
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
  }, [sourceUrl]);

  return (
    <div className={`${styles.stage} ${className}`} role="img" aria-label={label}>
      <div ref={mountRef} className={styles.canvas} />
      {status === "loading" && <div className={styles.status}><span />Preparing your model…</div>}
      {status === "error" && (
        <div className={styles.error} role="status">
          <strong>This GLB could not be previewed.</strong>
          <span>Re-export it as one self-contained binary glTF file.</span>
        </div>
      )}
      {status === "ready" && <span className={styles.orbitHint}>Drag to orbit · scroll to zoom</span>}
      {spots.map((spot, index) => {
        const position = MARKER_POSITIONS[index % MARKER_POSITIONS.length];
        const claimed = (spot.bids ?? 0) > 0;
        return (
          <button
            key={spot.id}
            type="button"
            className={`${styles.marker} ${claimed ? styles.claimed : ""} ${selectedSpotId === spot.id ? styles.selected : ""}`}
            style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
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
