import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Atmospheric Post-Processing Pipeline
 * - Restrained bloom (high threshold so only true emissives glow; no smearing/bands)
 * - Gentle vignette
 * - Light film grain
 * - Subtle chromatic aberration only at the screen edges
 */

const CinematicAtmosphereShader = {
  name: 'CinematicAtmosphereShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uGrainIntensity: { value: 0.022 },
    uVignetteDarkness: { value: 0.65 },
    uVignetteOffset: { value: 1.1 },
    uChromaIntensity: { value: 0.0022 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGrainIntensity;
    uniform float uVignetteDarkness;
    uniform float uVignetteOffset;
    uniform float uChromaIntensity;

    varying vec2 vUv;

    // Simple pseudo-random hash for fine film grain
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5, 0.5);
      vec2 toCenter = uv - center;
      float dist = length(toCenter);

      // 1. Subtle chromatic aberration only at screen edges
      float edgeFactor = smoothstep(0.4, 0.95, dist);
      vec2 chromaOffset = toCenter * (uChromaIntensity * edgeFactor);

      float r = texture2D(tDiffuse, uv - chromaOffset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + chromaOffset).b;
      vec3 color = vec3(r, g, b);

      // 2. Gentle natural vignette (darkens corners softly)
      float vignette = smoothstep(uVignetteOffset, uVignetteOffset - uVignetteDarkness, dist);
      color *= vignette;

      // 3. Very light film grain
      float grain = (hash(uv * uResolution + fract(uTime * 43.12)) - 0.5) * uGrainIntensity;
      color += grain;

      gl_FragColor = vec4(color, 1.0);
    }
  `
};

export class PostProcessingManager {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // Render target with HalfFloatType for high dynamic range
    const renderTarget = new THREE.WebGLRenderTarget(
      width * dpr,
      height * dpr,
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace
      }
    );

    this.composer = new EffectComposer(renderer, renderTarget);

    // 1. Scene render pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Restrained UnrealBloomPass:
    // Threshold 0.90: Only genuine high-intensity emissive meshes glow.
    // Zero smear on dark buildings or sky.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.45, // Strength: restrained, clean glow
      0.35, // Radius: tight, focused
      0.90  // Threshold: high, prevents washed out surfaces
    );
    this.composer.addPass(this.bloomPass);

    // 3. Atmosphere Shader Pass (Vignette, Grain, Edge Chromatic Aberration)
    this.atmospherePass = new ShaderPass(CinematicAtmosphereShader);
    this.atmospherePass.uniforms.uResolution.value.set(width, height);
    this.composer.addPass(this.atmospherePass);

    // 4. Output Pass with Color Management
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  update(delta, time) {
    if (this.atmospherePass) {
      this.atmospherePass.uniforms.uTime.value = time;
    }
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
    if (this.atmospherePass) {
      this.atmospherePass.uniforms.uResolution.value.set(width, height);
    }
  }

  render() {
    this.composer.render();
  }
}
