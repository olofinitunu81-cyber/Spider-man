// Exports every hero animation clip, baked on the hero's skeleton, to
//   assets/anim/hero_animations.glb   the skeleton, a neutral mannequin skinned to it, and all the clips
//   assets/anim/hero_animations.json  the same clips as three.js AnimationClip JSON, with the skeleton
// Run from this folder:  npm install  then  node export.mjs
// The skeleton is the hero model's own (standard Mixamo bone names, no prefix), so the clips play
// on that model directly in Blender, Unity, Unreal or Godot. A "Root" bone on the floor under the
// hips carries the root motion (rolls, dodges, jumps); the Hips track stays in place.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
globalThis.window = globalThis;
window.SMR = {};
window.THREE = THREE;
// GLTFExporter reads its binary output through a FileReader, which Node does not have
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; if (this.onloadend) this.onloadend(); if (this.onload) this.onload({ target: this }); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(b).toString('base64'); if (this.onloadend) this.onloadend(); if (this.onload) this.onload({ target: this }); }); }
  };
}
for (const f of ['js/game/herorig.js', 'js/game/anims.js']) vm.runInThisContext(fs.readFileSync(path.join(repo, f), 'utf8'), { filename: f });

const A = SMR.anim, solver = A.createSolver(SMR.heroRig.meta), baked = A.bake(solver);
const clips = A.toThree(baked, solver, { rootBone: 'Root' });

// the skeleton, with Root added as the parent of Hips (last in the joint list, so skin indices stay put)
const bones = solver.names.map((nm, i) => { const b = new THREE.Bone(); b.name = nm; b.position.copy(solver.restLocalPos[i]); b.quaternion.copy(solver.restLocalQ[i]); return b; });
const root = new THREE.Bone(); root.name = 'Root';
bones.forEach((b, i) => { const p = solver.parent[i]; if (p < 0) root.add(b); else bones[p].add(b); });
const mesh = new THREE.SkinnedMesh(A.mannequin(solver), new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.6, name: 'Mannequin' }));
mesh.name = 'Mannequin';
const armature = new THREE.Group(); armature.name = 'HeroRig';
armature.add(root); armature.add(mesh);
armature.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton([...bones, root]));
const scene = new THREE.Scene(); scene.add(armature);

const outDir = path.join(repo, 'assets/anim');
fs.mkdirSync(outDir, { recursive: true });
const glb = await new Promise((resolve, reject) => new GLTFExporter().parse(scene, resolve, reject, { binary: true, animations: clips }));
fs.writeFileSync(path.join(outDir, 'hero_animations.glb'), Buffer.from(glb));

const json = {
  format: 'hero-animations', version: 1, fps: A.FPS, units: 'metres', up: '+y', forward: '+z',
  note: 'Local bone rotations (quaternion x, y, z, w) at about 30 keys a second (each track has its own times; loops are spaced to close exactly and end on their first frame). Hips.position is in place; Root.position is the root motion.',
  skeleton: [{ name: 'Root', parent: null, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]
    .concat(solver.names.map((nm, i) => ({ name: nm, parent: solver.parent[i] < 0 ? 'Root' : solver.names[solver.parent[i]], position: solver.restLocalPos[i].toArray().map((x) => +x.toFixed(6)), quaternion: solver.restLocalQ[i].toArray().map((x) => +x.toFixed(6)) }))),
  clips: clips.map((c) => Object.assign({ name: c.name, duration: +c.duration.toFixed(4) }, c.userData, {
    tracks: THREE.AnimationClip.toJSON(c).tracks.map((t) => Object.assign(t, { times: t.times.map((x) => +x.toFixed(4)), values: t.values.map((x) => +x.toFixed(5)) })),
  })),
};
fs.writeFileSync(path.join(outDir, 'hero_animations.json'), JSON.stringify(json));
const kb = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0) + ' KB';
console.log(`${clips.length} clips -> assets/anim/hero_animations.glb (${kb('hero_animations.glb')}), hero_animations.json (${kb('hero_animations.json')})`);
