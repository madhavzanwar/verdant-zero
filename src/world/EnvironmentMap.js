import * as THREE from 'three';

/**
 * Procedural PMREM Environment Map Generator
 * Generates an HDR-style environment map containing:
 * - Deep indigo zenith & purple mid-sky
 * - Glowing magenta and orange horizon
 * - Intense neon cyan (#00f0ff) and hot pink (#ff007f) directional glows
 * Applied to scene.environment so all wet concrete, asphalt, and robot metal
 * pick up vivid reflections and highlights.
 */
export function createProceduralEnvMap(renderer) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const skyGeo = new THREE.SphereGeometry(60, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec3 d = normalize(vWorldPos);
        float h = d.y;

        vec3 zenith = vec3(0.02, 0.03, 0.08);
        vec3 midSky = vec3(0.08, 0.07, 0.16);
        vec3 horizonLow = vec3(0.14, 0.12, 0.22);
        vec3 horizonGlow = vec3(0.20, 0.15, 0.26);

        vec3 col;
        if (h > 0.25) {
          col = mix(midSky, zenith, clamp((h - 0.25) / 0.75, 0.0, 1.0));
        } else if (h > 0.0) {
          col = mix(horizonLow, midSky, clamp(h / 0.25, 0.0, 1.0));
        } else {
          col = mix(horizonGlow, horizonLow, clamp((h + 0.25) / 0.25, 0.0, 1.0));
        }

        // Restrained, soft directional env light (0.3x multiplier)
        float cyanGlow = max(0.0, dot(d, normalize(vec3(-0.8, 0.15, 0.6))));
        float amberGlow = max(0.0, dot(d, normalize(vec3(0.8, 0.15, -0.6))));

        col += vec3(0.0, 0.45, 0.55) * pow(cyanGlow, 5.0) * 0.35;
        col += vec3(0.55, 0.35, 0.15) * pow(amberGlow, 5.0) * 0.30;

        gl_FragColor = vec4(col * 0.30, 1.0);
      }
    `
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  envScene.add(skyMesh);

  const envTarget = pmremGenerator.fromScene(envScene);
  pmremGenerator.dispose();

  // Clean up temporary geometries
  skyGeo.dispose();
  skyMat.dispose();

  return envTarget.texture;
}
