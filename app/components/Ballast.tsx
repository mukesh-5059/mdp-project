import * as THREE from "three";
import { trackUniforms } from "./Track";

export const createBallastPlane = (scene: THREE.Scene) => {
  const ballastGeometry = new THREE.PlaneGeometry(1000, 20, 200, 20); // Length, Width, Segments
  
  const ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

  ballastMaterial.onBeforeCompile = (shader) => {
    // Pass in the same uniforms used by the track
    shader.uniforms.uWheelPositions = trackUniforms.uWheelPositions;
    shader.uniforms.uWheelCount = trackUniforms.uWheelCount;
    shader.uniforms.uLChar = trackUniforms.uLChar;
    shader.uniforms.uP = trackUniforms.uP;
    shader.uniforms.uStressScale = trackUniforms.uStressScale;

    // Add varyings and uniforms to the shader
    shader.vertexShader = `
      varying vec3 vWorldPosition;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );

    shader.fragmentShader = `
      uniform vec3 uWheelPositions[80];
      uniform int uWheelCount;
      uniform float uLChar;
      uniform float uP;
      uniform float uStressScale;
      varying vec3 vWorldPosition;

      // Re-using the same stress formula
      float getBendingStress(float dist, float l, float force) {
          float x = abs(dist);
          float bracket = sin(x/l) - cos(x/l);
          float exponent = exp(-x/l);
          return -0.25 * force * l * exponent * bracket;
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>

      float minDistanceToWheel = 100000.0; // Initialize with a very large value

      // Find the minimum 2D distance to any wheel contact point
      for (int i = 0; i < uWheelCount; i++) {
          vec2 pos2D = vec2(vWorldPosition.x, vWorldPosition.z);
          vec2 wheelPos2D = vec2(uWheelPositions[i].x, uWheelPositions[i].z);
          float dist2D = distance(pos2D, wheelPos2D);
          minDistanceToWheel = min(minDistanceToWheel, dist2D);
      }

      // Create a simple intensity based on this distance
      // Using an inverse linear falloff
      float falloffDistance = 10.0; // How far the effect spreads
      float baseIntensity = 1.0 - clamp(minDistanceToWheel / falloffDistance, 0.0, 1.0);
      
      // Square for a sharper falloff, toning it down as requested
      baseIntensity = pow(baseIntensity, 2.0); 

      // Apply overall scaling for visibility
      float finalIntensity = baseIntensity * uStressScale * 2.0;

      // Use the same multi-color heatmap
      vec3 heatColor;
      vec3 color1 = vec3(0.0, 0.0, 0.5); // Deep Blue
      vec3 color2 = vec3(0.0, 1.0, 1.0); // Cyan
      vec3 color3 = vec3(0.0, 1.0, 0.0); // Green
      vec3 color4 = vec3(1.0, 1.0, 0.0); // Yellow
      vec3 color5 = vec3(1.0, 0.0, 0.0); // Red
      vec3 color6 = vec3(0.4, 0.1, 0.0); // Brownish Red

      if (finalIntensity < 0.15) heatColor = mix(color1, color2, finalIntensity / 0.15);
      else if (finalIntensity < 0.3) heatColor = mix(color2, color3, (finalIntensity - 0.15) / 0.15);
      else if (finalIntensity < 0.45) heatColor = mix(color3, color4, (finalIntensity - 0.3) / 0.15);
      else if (finalIntensity < 0.6) heatColor = mix(color4, color5, (finalIntensity - 0.45) / 0.15);
      else if (finalIntensity < 0.8) heatColor = mix(color5, color6, (finalIntensity - 0.6) / 0.2);
      else heatColor = mix(color6, color6, clamp((finalIntensity - 0.8) / 0.7, 0.0, 1.0));

      diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.8);
      `
    );
  };

  const ballastPlane = new THREE.Mesh(ballastGeometry, ballastMaterial);
  ballastPlane.rotation.x = -Math.PI / 2;
  ballastPlane.position.y = -0.2; // Position it just below the sleepers
  ballastPlane.receiveShadow = true;
  
  scene.add(ballastPlane);

  return ballastPlane;
};
