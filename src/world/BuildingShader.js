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
    color: 0x2a3350,       // Dark blue-gray base color (never pure black)
    roughness: 0.35,       // Wet concrete sheen
    metalness: 0.50,       // High reflectivity with envMap
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

      // 2. Vertical Gradient on Facades (Brighter near street where neon spills upward)
      float streetSpill = clamp(1.0 - (vCustomWorldPos.y / 85.0), 0.0, 1.0);
      vec3 streetGlow = vec3(0.06, 0.03, 0.09) * pow(streetSpill, 2.0);
      gl_FragColor.rgb += streetGlow;

      // 3. Fresnel Rim Glow on Tower Silhouettes (Edges glow in soft cyan and magenta)
      vec3 viewDir = normalize(cameraPosition - vCustomWorldPos);
      float nDotV = clamp(dot(vCustomNormal, viewDir), 0.0, 1.0);
      float fresnel = pow(1.0 - nDotV, 3.5);

      // Cyan / Magenta variation along building coordinates
      vec3 rimColor = mix(
        vec3(0.0, 0.85, 1.0),   // Bright electric cyan
        vec3(1.0, 0.15, 0.70),   // Vivid neon magenta
        sin(vCustomWorldPos.x * 0.04 + vCustomWorldPos.z * 0.03) * 0.5 + 0.5
      );
      gl_FragColor.rgb += rimColor * (fresnel * 0.45);

      // Concrete facade turns into lush mossy dark green under green wave
      if (maxLife > 0.0) {
        vec3 mossColor = vec3(0.08, 0.26, 0.12);
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
            // Dark architectural window frame
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.06, 0.08, 0.12), 0.75);
          } else {
            // Glass pane: dark reflective unlit base
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.10, 0.14, 0.22), 0.60);

            // Pseudo-random selection for lit windows
            float rand = hash21(cellId + floor(vCustomWorldPos.xz * 0.05));

            // ~15% of windows lit with warm orange, cyan, or pink
            if (rand < 0.16) {
              vec3 winColor;
              if (rand < 0.04) {
                winColor = vec3(0.0, 0.92, 1.0);   // Cold cyan
              } else if (rand < 0.08) {
                winColor = vec3(1.0, 0.25, 0.65);  // Neon pink
              } else {
                winColor = vec3(1.0, 0.65, 0.22);  // Warm amber orange
              }

              // Under living green wave, windows shift toward warm radiant emerald
              if (maxLife > 0.0) {
                winColor = mix(winColor, vec3(0.20, 1.0, 0.50), maxLife * 0.88);
              }

              // Subtle flicker on a small fraction of windows
              float flicker = 1.0;
              if (rand < 0.03) {
                flicker = 0.65 + 0.35 * sin(uTime * 3.5 + rand * 40.0);
              }

              // Emissive bloom contribution
              gl_FragColor.rgb += winColor * (1.1 * flicker);
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
