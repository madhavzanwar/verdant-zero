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
 * - Zero-allocation per-frame execution
 * - Efficient render target reuse without memory growth
 */

const CinematicAtmosphereShader = {
  name: 'CinematicAtmosphereShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(typeof window !== 'undefined' ? window.innerWidth : 1920, typeof window !== 'undefined' ? window.innerHeight : 1080) },
    uGrainIntensity: { value: 0.004 },
    uVignetteDarkness: { value: 0.22 },
    uVignetteOffset: { value: 1.25 },
    uDesaturation: { value: 0.30 }
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
    uniform float uDesaturation;

    varying vec2 vUv;

    // Subtle fine film grain hash (no scanlines or bands)
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec3 color = texture2D(tDiffuse, uv).rgb;

      // 1. Controlled ~30% desaturation for calm, restrained palette
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(luma), uDesaturation);

      // 2. Gentle minimal vignette (subtly frames scene)
      vec2 center = vec2(0.5, 0.5);
      float dist = length(uv - center);
      float vignette = smoothstep(uVignetteOffset, uVignetteOffset - uVignetteDarkness, dist);
      color *= vignette;

      // 3. Very subtle organic grain (clean, no scanline or chromatic smear)
      float grain = (hash(uv * uResolution + fract(uTime * 17.15)) - 0.5) * uGrainIntensity;
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
    const dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : Math.min(window.devicePixelRatio || 1, 1.5);

    // Initial render target sized to effective pixel resolution
    const renderTarget = new THREE.WebGLRenderTarget(
      Math.floor(width * dpr),
      Math.floor(height * dpr),
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false
      }
    );

    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);

    // 1. Scene render pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Restrained Half-Resolution UnrealBloomPass:
    // Halving resolution (w/2, h/2) saves 75% fill-rate cost while retaining lush soft glow!
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(width / 2), Math.floor(height / 2)),
      0.20, // Strength: 0.20
      0.40, // Radius: 0.40
      0.92  // Threshold: 0.92
    );

    // Optimize UnrealBloomPass.setSize to eliminate per-resize GC allocations:
    // Reuse existing Vector2 instances in separableBlurMaterials rather than allocating new ones
    if (this.bloomPass.separableBlurMaterials) {
      this.bloomPass.setSize = (w, h) => {
        let resx = Math.round(w / 4);
        let resy = Math.round(h / 4);
        this.bloomPass.renderTargetBright.setSize(resx, resy);
        for (let i = 0; i < this.bloomPass.nMips; i++) {
          this.bloomPass.renderTargetsHorizontal[i].setSize(resx, resy);
          this.bloomPass.renderTargetsVertical[i].setSize(resx, resy);
          const invSizeUniform = this.bloomPass.separableBlurMaterials[i].uniforms['invSize'];
          if (invSizeUniform && invSizeUniform.value && typeof invSizeUniform.value.set === 'function') {
            invSizeUniform.value.set(1 / resx, 1 / resy);
          } else if (invSizeUniform) {
            invSizeUniform.value = new THREE.Vector2(1 / resx, 1 / resy);
          }
          resx = Math.round(resx / 2);
          resy = Math.round(resy / 2);
        }
      };
    }

    this.composer.addPass(this.bloomPass);

    // 3. Atmosphere Shader Pass (Subtle vignette, 30% desaturation, micro grain)
    this.atmospherePass = new ShaderPass(CinematicAtmosphereShader);
    this.atmospherePass.uniforms.uResolution.value.set(width, height);
    this.composer.addPass(this.atmospherePass);

    // 4. Output Pass
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setQuality(tier) {
    if (!this.bloomPass) return;
    if (tier === 'low') {
      this.bloomPass.enabled = false;
      if (this.atmospherePass) this.atmospherePass.enabled = false;
    } else if (tier === 'medium') {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.15;
      if (this.atmospherePass) this.atmospherePass.enabled = true;
    } else {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.20;
      if (this.atmospherePass) this.atmospherePass.enabled = true;
    }
  }

  update(delta, time) {
    if (this.atmospherePass) {
      this.atmospherePass.uniforms.uTime.value = time;
    }
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    if (this.bloomPass && this.bloomPass.resolution) {
      this.bloomPass.resolution.set(Math.floor(width / 2), Math.floor(height / 2));
    }
    if (this.atmospherePass && this.atmospherePass.uniforms.uResolution) {
      this.atmospherePass.uniforms.uResolution.value.set(width, height);
    }
  }

  setPixelRatio(pixelRatio) {
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
    }
  }

  render(delta) {
    this.composer.render(delta);
  }

  dispose() {
    if (this.bloomPass) {
      if (typeof this.bloomPass.dispose === 'function') {
        this.bloomPass.dispose();
      }
      this.bloomPass = null;
    }
    if (this.atmospherePass) {
      if (this.atmospherePass.material) {
        this.atmospherePass.material.dispose();
      }
      if (typeof this.atmospherePass.dispose === 'function') {
        this.atmospherePass.dispose();
      }
      this.atmospherePass = null;
    }
    if (this.renderPass) {
      if (typeof this.renderPass.dispose === 'function') {
        this.renderPass.dispose();
      }
      this.renderPass = null;
    }
    if (this.outputPass) {
      if (typeof this.outputPass.dispose === 'function') {
        this.outputPass.dispose();
      }
      this.outputPass = null;
    }
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}
