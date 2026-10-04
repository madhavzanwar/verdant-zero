import * as THREE from 'three';

/**
 * Procedural Building Shader
 * - Cold, dark, desaturated gray-blue concrete with wet sheen
 * - Hash-based procedural window grid (small architectural panes, 15% lit in orange, pink, cyan, few flicker)
 * - Living green wave spreading over facade into mossy dark green with warm windows
 * - Zero blown-out smears or full-wall whiteouts
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
    color: 0x161b24,       // Cold desaturated dark gray-blue concrete
    roughness: 0.38,       // Wet surface reflection
    metalness: 0.2,
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

    // Fragment Shader: Window Grid Hash & Living Green Wave Reveal
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

      // 1. Calculate Living Green Wave Reveal First
      float maxLife = 0.0;
      float noiseVal = simpleNoise(vCustomWorldPos * 0.18);

      for (int i = 0; i < 8; i++) {
        if (i >= uPlantCount) break;
        float d = distance(vCustomWorldPos, uPlantSpots[i]);
        float waveRadius = uPlantRadii[i];
        
        // Soft organic mossy edge spreading outward
        float life = smoothstep(waveRadius + 2.5, waveRadius - 2.5, d + noiseVal * 3.5);
        maxLife = max(maxLife, life);
      }

      // Concrete facade turns into mossy dark green
      if (maxLife > 0.0) {
        vec3 mossColor = vec3(0.06, 0.20, 0.09);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mossColor, maxLife * 0.82);
      }

      // 2. Procedural Window Grid on vertical building walls
      vec3 absNormal = abs(vCustomNormal);
      if (absNormal.y < 0.65) {
        float uCoord = (absNormal.x > absNormal.z) ? vCustomWorldPos.z : vCustomWorldPos.x;
        float vCoord = vCustomWorldPos.y;

        // Small, crisp architectural window panes: 1.4m width x 2.2m floor height
        vec2 grid = vec2(uCoord / 1.4, vCoord / 2.2);
        vec2 cellId = floor(grid);
        vec2 cellUv = fract(grid);

        // Window pane margins (clean mullions/borders)
        if (cellUv.x > 0.25 && cellUv.x < 0.75 && cellUv.y > 0.28 && cellUv.y < 0.78) {
          float rand = hash21(cellId + floor(vCustomWorldPos.xz * 0.08));

          // 15% of windows glow
          if (rand < 0.15) {
            vec3 winColor;
            if (rand < 0.04) {
              winColor = vec3(0.0, 0.85, 1.0);  // Cold cyan
            } else if (rand < 0.08) {
              winColor = vec3(1.0, 0.22, 0.60); // Neon pink
            } else {
              winColor = vec3(1.0, 0.58, 0.18); // Warm orange
            }

            // If touched by living green wave, windows shift toward warm radiant emerald
            if (maxLife > 0.0) {
              winColor = mix(winColor, vec3(0.15, 1.0, 0.45), maxLife * 0.85);
            }

            // Slow subtle flicker on a few windows
            float flicker = 1.0;
            if (rand < 0.025) {
              flicker = 0.6 + 0.4 * sin(uTime * 4.0 + rand * 30.0);
            }

            // Restrained emissive glow (clean, non-blown out)
            gl_FragColor.rgb += winColor * (0.95 * flicker);
          }
        }
      }
      `
    );
  };

  material.userData.uniforms = uniforms;
  return material;
}
