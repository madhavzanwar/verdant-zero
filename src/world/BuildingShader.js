import * as THREE from 'three';

/**
 * Procedural Building Shader
 * - Base color: dark blue-gray concrete (#2a3350), never pure black
 * - Roughness: 0.35, Metalness: 0.50
 * - Fresnel rim glow in cyan & magenta for crisp silhouette readability
 * - Vertical facade gradient: street neon spill fading upward
 * - Windows built into facade shader: flush with walls, recessed frame, lit panes in orange, pink, cyan
 * - Living green wave spreading over facade into mossy dark green with warm glowing windows
 */

export function createBuildingMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uPlantSpots: { value: [
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0),
      new THREE.Vector3(0, -999, 0)
    ] },
    uPlantRadii: { value: [0, 0, 0, 0, 0, 0, 0, 0] },
    uPlantCount: { value: 0 }
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0x1f2638,       // Deep navy/slate concrete base
    roughness: 0.85,       // Matte concrete surface
    metalness: 0.05,       // Low metalness to prevent high specularity
    fog: true
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uPlantSpots = uniforms.uPlantSpots;
    shader.uniforms.uPlantRadii = uniforms.uPlantRadii;
    shader.uniforms.uPlantCount = uniforms.uPlantCount;

    material.userData.shader = shader;

    // Vertex Shader: Capture accurate world position and normal across InstancedMesh
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      varying vec3 vCustomWorldPos;
      varying vec3 vCustomNormal;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      /* glsl */ `
      #include <worldpos_vertex>
      #if defined( USE_INSTANCING )
        vec4 customWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vCustomNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
      #else
        vec4 customWorld = modelMatrix * vec4(transformed, 1.0);
        vCustomNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      #endif
      vCustomWorldPos = customWorld.xyz;
      `
    );

    // Fragment Shader: Window Grid Hash, Facade Gradient, Fresnel Rim & Green Wave Reveal
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>

      uniform float uTime;
      uniform vec3 uPlantSpots[8];
      uniform float uPlantRadii[8];
      uniform int uPlantCount;

      varying vec3 vCustomWorldPos;
      varying vec3 vCustomNormal;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float simpleNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = i.x + i.y * 57.0 + 113.0 * i.z;
        return mix(
          mix(mix(hash21(vec2(n, 0.0)), hash21(vec2(n + 1.0, 0.0)), f.x),
              mix(hash21(vec2(n + 57.0, 0.0)), hash21(vec2(n + 58.0, 0.0)), f.x), f.y),
          mix(mix(hash21(vec2(n + 113.0, 0.0)), hash21(vec2(n + 114.0, 0.0)), f.x),
              mix(hash21(vec2(n + 170.0, 0.0)), hash21(vec2(n + 171.0, 0.0)), f.x), f.y), f.z
        );
      }
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
      #include <dithering_fragment>

      // 1. Calculate Living Green Wave Reveal
      float maxLife = 0.0;
      float noiseVal = simpleNoise(vCustomWorldPos * 0.18);

      for (int i = 0; i < 8; i++) {
        if (i >= uPlantCount) break;
        float d = distance(vCustomWorldPos, uPlantSpots[i]);
        float waveRadius = uPlantRadii[i];
        
        // Soft organic mossy edge spreading outward
        float life = smoothstep(waveRadius + 3.0, waveRadius - 3.0, d + noiseVal * 4.0);
        maxLife = max(maxLife, life);
      }

      // 2. Vertical Gradient on Facades (Gentle street glow fading upward)
      float streetSpill = clamp(1.0 - (vCustomWorldPos.y / 90.0), 0.0, 1.0);
      vec3 streetGlow = vec3(0.02, 0.025, 0.04) * pow(streetSpill, 2.0);
      gl_FragColor.rgb += streetGlow;

      // 3. Subtle Fresnel Rim on Tower Silhouettes (Quiet slate/cyan definition, low intensity)
      vec3 viewDir = normalize(cameraPosition - vCustomWorldPos);
      float nDotV = clamp(dot(vCustomNormal, viewDir), 0.0, 1.0);
      float fresnel = pow(1.0 - nDotV, 4.0);
      vec3 rimColor = vec3(0.15, 0.35, 0.45);
      gl_FragColor.rgb += rimColor * (fresnel * 0.18);

      // Concrete facade turns into calm mossy slate green under green wave
      if (maxLife > 0.0) {
        vec3 mossColor = vec3(0.06, 0.22, 0.10);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mossColor, maxLife * 0.85);
      }

      // 4. Procedural Window Grid Flush with Facade Walls
      vec3 absNormal = abs(vCustomNormal);
      if (absNormal.y < 0.65) {
        float uCoord = (absNormal.x > absNormal.z) ? vCustomWorldPos.z : vCustomWorldPos.x;
        float vCoord = vCustomWorldPos.y;

        // Architectural window grid: 1.8m width x 2.8m floor height
        vec2 grid = vec2(uCoord / 1.8, vCoord / 2.8);
        vec2 cellId = floor(grid);
        vec2 cellUv = fract(grid);

        // Window Frame (Recessed dark architectural mullions)
        bool isFrame = (cellUv.x > 0.16 && cellUv.x < 0.84 && cellUv.y > 0.18 && cellUv.y < 0.82);
        bool isGlass = (cellUv.x > 0.22 && cellUv.x < 0.78 && cellUv.y > 0.24 && cellUv.y < 0.76);

        if (isFrame) {
          if (!isGlass) {
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.04, 0.05, 0.08), 0.80);
          } else {
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.08, 0.10, 0.15), 0.70);

            // Pseudo-random selection for lit windows
            float rand = hash21(cellId + floor(vCustomWorldPos.xz * 0.05));

            // ~12% of windows lit with soft warm amber
            if (rand < 0.12) {
              vec3 winColor = vec3(0.95, 0.68, 0.32); // Soft warm amber

              // Under living green wave, windows shift toward radiant green
              if (maxLife > 0.0) {
                winColor = mix(winColor, vec3(0.15, 0.90, 0.45), maxLife * 0.90);
              }

              // Subtle slow flicker on a small fraction of windows
              float flicker = 1.0;
              if (rand < 0.02) {
                flicker = 0.80 + 0.20 * sin(uTime * 2.0 + rand * 30.0);
              }

              gl_FragColor.rgb += winColor * (0.65 * flicker);
            }
          }
        }
      }
      `
    );
  };

  material.userData.uniforms = uniforms;
  return material;
}
