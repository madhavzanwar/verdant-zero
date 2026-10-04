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

        vec3 zenith = vec3(0.04, 0.05, 0.18);
        vec3 midSky = vec3(0.32, 0.08, 0.42);
        vec3 magenta = vec3(1.0, 0.12, 0.55);
        vec3 orange = vec3(1.0, 0.45, 0.16);

        vec3 col;
        if (h > 0.25) {
          col = mix(midSky, zenith, clamp((h - 0.25) / 0.75, 0.0, 1.0));
        } else if (h > 0.0) {
          col = mix(magenta, midSky, clamp(h / 0.25, 0.0, 1.0));
        } else {
          col = mix(orange, magenta, clamp((h + 0.25) / 0.25, 0.0, 1.0));
        }

        // Concentrated neon light sources in the environment
        float cyanGlow = max(0.0, dot(d, normalize(vec3(-0.8, 0.15, 0.6))));
        float pinkGlow = max(0.0, dot(d, normalize(vec3(0.8, 0.15, -0.6))));
        float purpleGlow = max(0.0, dot(d, normalize(vec3(0.2, 0.4, 0.9))));

        col += vec3(0.0, 0.92, 1.0) * pow(cyanGlow, 5.0) * 1.4;
        col += vec3(1.0, 0.15, 0.65) * pow(pinkGlow, 5.0) * 1.4;
        col += vec3(0.65, 0.20, 1.0) * pow(purpleGlow, 4.0) * 1.0;

        gl_FragColor = vec4(col, 1.0);
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
