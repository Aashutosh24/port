// One-off script used to shrink motorcycle.glb (20 MB → 2 MB). Not part of the build.
// Needs, temporarily:  npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// Usage:               node scripts/optimize-model.mjs original.glb public/models/motorcycle.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.0008 }), // 462k → 139k triangles
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 88, slots: /^baseColor/ }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 90, resize: [1024, 1024], slots: /^(normal|metallicRoughness)/ }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write(output, doc);
