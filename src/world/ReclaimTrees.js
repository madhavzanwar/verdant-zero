import * as THREE from 'three';
import { Tree } from '../vendor/ez-tree/tree.js';

/**
 * Reclaim Trees — a bioluminescent tree (or bush, on skyways and rooftops) grows out of every
 * planter whose vine reaches maturity, so reclaimed streets visibly turn into a canopy.
 *
 * Geometry comes from EZ-Tree (vendored, MIT) via Tree#createGeometry() at reduced detail.
 * Materials are Verdant Zero's own and texture-free: dark bark with glowing sap, and leaves drawn
 * into a small CanvasTexture at runtime with a vertex-shader wind sway.
 *
 * Budget: ~1.1–1.6k triangles per tree, ~38k with all 28 planters reclaimed.
 * Each variant is one InstancedMesh pair (bark + leaves). Active instances are kept packed at the
 * front of the buffer and `count` is set to the number in use, so ungrown trees cost nothing.
 */

const VARIANTS = [
  // Street-level trees
  { preset: 'Aspen Small', seed: 4127, height: 7.5, elevated: false, detail: {} },
  { preset: 'Oak Small', seed: 9314, height: 6.5, elevated: false, detail: { sectionStride: 3, segmentFactor: 0.5, leafStride: 3, leafScale: 2.0 } },
  // Compact bushes for skyways and roofs
  { preset: 'Bush 2', seed: 2201, height: 3.2, elevated: true, detail: { sectionStride: 3, segmentFactor: 0.5, leafStride: 3, leafScale: 2.0 } }
];

const DETAIL = { sectionStride: 2, segmentFactor: 0.6, leafStride: 2, leafScale: 1.5, billboard: 'single' };
const GROW_TIME = 3.5;

function createLeafTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Pointed leaf silhouette with a bright midrib (white; tinted per instance)
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, 'rgba(150,150,150,1)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.04);
  ctx.bezierCurveTo(size * 0.95, size * 0.3, size * 0.85, size * 0.78, size * 0.5, size * 0.98);
  ctx.bezierCurveTo(size * 0.15, size * 0.78, size * 0.05, size * 0.3, size * 0.5, size * 0.04);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,1)'; // glowing midrib (catches the bloom)
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.1);
  ctx.lineTo(size * 0.5, size * 0.95);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ReclaimTrees {
  constructor(scene, maxTrees) {
    this.scene = scene;
    this.maxTrees = maxTrees;
    this.timeUniform = { value: 0 };
    this.trees = new Map(); // planter index -> { variant, slot, x, y, z, rot, grow, health }
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._leafHealthy = new THREE.Color(0x0a8f52);
    this._leafAlt = new THREE.Color(0x0b7f8c);
    this._leafDead = new THREE.Color(0x3a2e1c);

    this.barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d0907,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.3,
      emissive: 0x04281a,
      emissiveIntensity: 1.0
    });

    this.leafMaterial = new THREE.MeshBasicMaterial({
      map: createLeafTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide
    });
    this.leafMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Gentle wind sway, stronger toward the crown, phase-shifted per instance
          float phase = 0.0;
          #ifdef USE_INSTANCING
            phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
          #endif
          float sway = sin(uTime * 1.6 + phase + position.y * 1.3) * 0.06 * position.y;
          transformed.x += sway;
          transformed.z += sway * 0.6;
        `);
    };

    this.variants = VARIANTS.map(v => this.buildVariant(v));
  }

  buildVariant(def) {
    const tree = new Tree();
    tree.loadPreset(def.preset);
    tree.options.seed = def.seed;
    const { branches, leaves } = tree.createGeometry({ ...DETAIL, ...def.detail });

    // Normalise to unit height with the base at the origin
    branches.computeBoundingBox();
    const box = branches.boundingBox;
    const s = 1 / Math.max(0.001, box.max.y - box.min.y);
    for (const g of [branches, leaves]) {
      g.translate(0, -box.min.y, 0);
      g.scale(s, s, s);
      g.computeBoundingSphere();
    }

    const bark = new THREE.InstancedMesh(branches, this.barkMaterial, this.maxTrees);
    const leafMesh = new THREE.InstancedMesh(leaves, this.leafMaterial, this.maxTrees);
    for (const m of [bark, leafMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.scene.add(m);
    }
    leafMesh.setColorAt(0, this._leafHealthy); // allocate instanceColor
    return { ...def, bark, leaves: leafMesh, active: [], triangles: (branches.index.count + leaves.index.count) / 3 };
  }

  /** Start growing a tree on planter `index`. */
  add(index, pos, elevated) {
    if (this.trees.has(index)) return;
    const pool = this.variants.filter(v => v.elevated === elevated);
    const variant = pool[index % pool.length];
    const tree = {
      index, variant,
      x: pos.x, y: pos.y + 0.2, z: pos.z,
      rot: (index * 2.399) % (Math.PI * 2),
      scale: variant.height * (0.85 + ((index * 7) % 5) * 0.06),
      tint: index % 3 === 0 ? this._leafAlt : this._leafHealthy,
      grow: 0,
      health: 1,
      started: false
    };
    tree.slot = variant.active.length;
    variant.active.push(tree);
    this.trees.set(index, tree);
    this.writeInstance(tree);
    variant.bark.count = variant.leaves.count = variant.active.length;
  }

  /** Begin the growth animation (called when the vine matures). */
  startGrowth(index) {
    const t = this.trees.get(index);
    if (t) t.started = true;
  }

  setHealth(index, health) {
    const t = this.trees.get(index);
    if (t) t.health = health;
  }

  remove(index) {
    const tree = this.trees.get(index);
    if (!tree) return;
    const v = tree.variant;
    const last = v.active.pop();
    if (last !== tree) {
      // Move the last active instance into the freed slot to keep the buffer packed
      v.active[tree.slot] = last;
      last.slot = tree.slot;
      this.writeInstance(last);
    }
    this.trees.delete(index);
    v.bark.count = v.leaves.count = v.active.length;
  }

  clear() {
    for (const v of this.variants) {
      v.active.length = 0;
      v.bark.count = v.leaves.count = 0;
    }
    this.trees.clear();
  }

  writeInstance(t) {
    const d = this._dummy;
    const g = t.grow;
    // Ease-out-back so the crown "pops" into place
    const e = g >= 1 ? 1 : 1 + 2.2 * Math.pow(g - 1, 3) + 1.2 * Math.pow(g - 1, 2);
    const s = Math.max(0.0001, t.scale * e);
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(0, t.rot, 0);
    d.scale.set(s, s, s);
    d.updateMatrix();
    t.variant.bark.setMatrixAt(t.slot, d.matrix);
    t.variant.leaves.setMatrixAt(t.slot, d.matrix);
    this._color.copy(this._leafDead).lerp(t.tint, t.health);
    t.variant.leaves.setColorAt(t.slot, this._color);
    t.variant.bark.instanceMatrix.needsUpdate = true;
    t.variant.leaves.instanceMatrix.needsUpdate = true;
    t.variant.leaves.instanceColor.needsUpdate = true;
  }

  update(delta, time) {
    this.timeUniform.value = time;
    for (const t of this.trees.values()) {
      let dirty = false;
      if (t.started && t.grow < 1) {
        t.grow = Math.min(1, t.grow + delta / GROW_TIME);
        dirty = true;
      }
      if (t.health !== t._lastHealth) {
        t._lastHealth = t.health;
        dirty = true;
      }
      if (dirty) this.writeInstance(t);
    }
  }

  /** Low quality tier hides the trees (~1.4k triangles each); vines and moss still show progress. */
  setVisible(visible) {
    for (const v of this.variants) {
      v.bark.visible = visible;
      v.leaves.visible = visible;
    }
  }

  /** Triangles currently submitted (for diagnostics). */
  get triangleCount() {
    return this.variants.reduce((sum, v) => sum + v.triangles * v.active.length, 0);
  }
}
