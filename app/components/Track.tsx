import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

export const trackUniforms = {
  uWheelPositions: { value: new Array(80).fill(new THREE.Vector3()) },

  uWheelCount: { value: 0 },

  uLChar: { value: 4.0 }, // Characteristic length (m)

  uP: { value: 15.0 }, // Load force (N)

  uStressScale: { value: 0.15 }, // Scales the stress for visualization
};

export const createTrackSegment = (
  scene: THREE.Scene,
  world: CANNON.World,
  x: number,
  y: number,
  z: number,
  length: number,
  scale: number,
  trackVisualYOffset: number, // Add visual Y offset parameter
) => {
  const railHeight = 0.5;
  const trackWidth = 6;

  // ... (physics bodies remain the same)

  // 1. Physics: Floor
  const floorBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(length / 2, 0.1, trackWidth / 2)),
    position: new CANNON.Vec3(x, y, z),
  });
  world.addBody(floorBody);

  // 2. Physics: Rails
  const railShape = new CANNON.Box(
    new CANNON.Vec3(length / 2, railHeight, 0.1),
  );
  const leftRail = new CANNON.Body({
    mass: 0,
    shape: railShape,
    position: new CANNON.Vec3(x, y + railHeight, z + trackWidth / 2),
  });
  const rightRail = new CANNON.Body({
    mass: 0,
    shape: railShape,
    position: new CANNON.Vec3(x, y + railHeight, z - trackWidth / 2),
  });

  world.addBody(leftRail);
  world.addBody(rightRail);

  const loader = new GLTFLoader();

  // Load both models in parallel
  Promise.all([
    loader.loadAsync("/assets/train/rail.glb"),
    loader.loadAsync("/assets/train/sleepers.glb"),
  ]).then(([railGltf, sleepersGltf]) => {
    const railModel = railGltf.scene;
    const sleepersModel = sleepersGltf.scene;

    // Apply the new scale
    railModel.scale.set(scale, scale, scale);
    sleepersModel.scale.set(scale, scale, scale);

    // --- Rail Material (Detailed Heatmap) ---
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });
    railMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWheelPositions = trackUniforms.uWheelPositions;
      shader.uniforms.uWheelCount = trackUniforms.uWheelCount;
      shader.uniforms.uLChar = trackUniforms.uLChar;
      shader.uniforms.uP = trackUniforms.uP;
      shader.uniforms.uStressScale = trackUniforms.uStressScale;

      shader.vertexShader =
        `
        varying vec3 vWorldPosition;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `
        #include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

      shader.fragmentShader =
        `
        uniform vec3 uWheelPositions[80];
        uniform int uWheelCount;
        uniform float uLChar;       // Characteristic Length
        uniform float uP;           // Load
        uniform float uStressScale; // Visual scaler

        varying vec3 vWorldPosition;

        // The Zimmermann formula for bending stress under a point load
        float getBendingStress(float dist, float l, float force) {
            float x = abs(dist);
            // This term creates the wave-like oscillation
            float bracket = sin(x/l) - cos(x/l);
            float exponent = exp(-x/l);
            // Invert the result to align with visual expectation (compression = hot, relief = cool)
            return -0.25 * force * l * exponent * bracket;
        }

      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        
        float totalStress = 0.0;

        // Superposition: Sum the stress from all nearby wheels
        for (int i = 0; i < uWheelCount; i++) {
            // The track is oriented along the X-axis in the scene
            float dist = vWorldPosition.x - uWheelPositions[i].x;
            
            // Accumulate stress, but only if the wheel is on the same side of the track,
            // and only if it's reasonably close to avoid calculating for distant wheels.
            if (abs(vWorldPosition.z - uWheelPositions[i].z) < 2.0 && abs(dist) < 50.0) {
               totalStress += getBendingStress(dist, uLChar, uP);
            }
        }

        vec3 heatColor;

        if (totalStress < 0.0) {
            // Negative stress (relief) is visualized as blue
            float reliefIntensity = abs(totalStress) * uStressScale * 2.0; // Amplify relief visibility
            heatColor = mix(vec3(0.05), vec3(0.0, 0.5, 1.0), clamp(reliefIntensity, 0.0, 1.0));
        } else {
            // Positive stress (compression) uses the multi-color heatmap
            float finalIntensity = totalStress * uStressScale;

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
        }

        // Mix the original material color with our new heatmap color
        diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.9);
        `,
      );
    };

    // --- Sleeper Material (Advanced Heatmap) ---
    const sleeperMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555, // Slightly lighter base color
    });
    sleeperMaterial.onBeforeCompile = (shader) => {
      // Use all the same uniforms as the rail for consistency
      shader.uniforms.uWheelPositions = trackUniforms.uWheelPositions;
      shader.uniforms.uWheelCount = trackUniforms.uWheelCount;
      shader.uniforms.uLChar = trackUniforms.uLChar;
      shader.uniforms.uP = trackUniforms.uP;
      shader.uniforms.uStressScale = trackUniforms.uStressScale;

      shader.vertexShader =
        `
          varying vec3 vWorldPosition;
        ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `
          #include <worldpos_vertex>
          vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `,
      );

      shader.fragmentShader =
        `
          uniform vec3 uWheelPositions[80];
          uniform int uWheelCount;
          uniform float uLChar;
          uniform float uP;
          uniform float uStressScale;

          varying vec3 vWorldPosition;

          // Re-using the same function as the rail shader
          float getBendingStress(float dist, float l, float force) {
              float x = abs(dist);
              float bracket = sin(x/l) - cos(x/l);
              float exponent = exp(-x/l);
              return -0.25 * force * l * exponent * bracket;
          }
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
          #include <color_fragment>
          
          // --- Corrected "Projection" Model ---

          // 1. Get a single "base stress" for the entire X-coordinate slice of the sleeper
          float stressLeft = 0.0;
          float stressRight = 0.0;
          for (int i = 0; i < uWheelCount; i++) {
              float distX = vWorldPosition.x - uWheelPositions[i].x;
              if (abs(distX) < 50.0) {
                // Left rail is on the +Z side, Right rail is on the -Z side
                if (uWheelPositions[i].z > 0.0) {
                    stressLeft += getBendingStress(distX, uLChar, uP);
                } else {
                    stressRight += getBendingStress(distX, uLChar, uP);
                }
              }
          }
          // The base stress is the one with the largest magnitude (compression or relief).
          float baseStressX = abs(stressLeft) > abs(stressRight) ? stressLeft : stressRight;

          // 2. Interpolate that single base value ONLY along the Z-axis
          float railZPosition = 3.0; // Half of trackWidth
          float distToNearestRail = min(abs(vWorldPosition.z - railZPosition), abs(vWorldPosition.z + railZPosition));
          
          float falloffSpread;
          // If the pixel is between the Z=0 axis and the rail's centerline, spread the falloff more
          if (abs(vWorldPosition.z) < railZPosition) {
            falloffSpread = 6.0;
          } else {
            falloffSpread = 4.0;
          }

          float zFalloff = 1.0 - smoothstep(0.0, falloffSpread, distToNearestRail);

          // 3. Modulate the base stress by the falloff
          float modulatedStress = baseStressX * zFalloff;

          vec3 heatColor;

          if (modulatedStress < 0.0) {
              // Negative stress (relief) is visualized as blue, mimicking the rail shader
              float reliefIntensity = abs(modulatedStress) * uStressScale * 2.0; // Amplify relief visibility
              heatColor = mix(vec3(0.05), vec3(0.0, 0.5, 1.0), clamp(reliefIntensity, 0.0, 1.0));
          } else {
              // Positive stress (compression) uses the multi-color heatmap
              float finalIntensity = modulatedStress * 0.6 * zFalloff * uStressScale * 1.5;

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
          }

          diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.9);
          `,
      );
    };

    // Apply materials
    railModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.name = "rail";
        child.material = railMaterial;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    sleepersModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.name = "sleeper";
        child.material = sleeperMaterial;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Combine into a single group for cloning, and rotate it
    const trackSegment = new THREE.Group();
    trackSegment.add(railModel);
    trackSegment.add(sleepersModel);
    trackSegment.rotation.y = Math.PI / 2; // Rotate to align with X-axis

    // Calculate length and clone
    const box = new THREE.Box3().setFromObject(trackSegment);
    const pieceLength = box.max.x - box.min.x; // Length is now along X

    const numberOfPieces = Math.ceil(length / pieceLength);

    for (let i = 0; i < numberOfPieces; i++) {
      const trackClone = trackSegment.clone();

      const startX = x - length / 2 + pieceLength / 2;
      trackClone.position.set(
        startX + i * pieceLength,
        y + trackVisualYOffset,
        z,
      );
      trackClone.rotation.y += Math.PI / 2; // Apply additional 90-degree rotation

      scene.add(trackClone);
    }
  });
};
