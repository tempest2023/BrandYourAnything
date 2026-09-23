import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// The loader uses ProgressEvent for data-URI buffers, including in Node.
globalThis.ProgressEvent ??= class {
  constructor(type, data) { this.type = type; Object.assign(this, data); }
};

export async function loadPreset(id) {
  const bytes = readFileSync(`public/models/presets/${id}.glb`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  // Geometry tests do not require browser image decoding. Keep mesh transforms,
  // indices, normals and compressed buffers exactly as authored.
  delete json.images;
  delete json.textures;
  delete json.samplers;
  delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const binary = bytes.subarray(28 + jsonLength);
  json.buffers[0].uri = "data:application/octet-stream;base64," + binary.toString("base64");
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  const root = new THREE.Group();
  root.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 2.8 / Math.max(...size.toArray());
  root.scale.setScalar(scale);
  root.position.copy(center).multiplyScalar(-scale);
  root.updateMatrixWorld(true);
  return { root };
}
