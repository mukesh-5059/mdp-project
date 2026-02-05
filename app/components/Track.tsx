import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

export const trackUniforms = {
  uContactPoints: { value: new Array(80).fill(new THREE.Vector3()) },
  uNumPoints: { value: 0 },
  uRadius: { value: 2.0 }, // How far the "glow" spreads
};

export const createTrackSegment = (
  scene: THREE.Scene,
  world: CANNON.World,
  x: number,
  y: number,
  z: number,
  length: number,
) => {
  const trackMaterial = new CANNON.Material("track");
  const railHeight = 0.5;
  const trackWidth = 6;

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

  // 3. Visuals
  const loader = new GLTFLoader();

  // Update path to where your scene.gltf is located
  loader.load("/assets/fz_track/scene.gltf", (gltf) => {
    const originalModel = gltf.scene;
    originalModel.scale.set(5, 5, 5);
    originalModel.rotation.y = Math.PI / 2;
    originalModel.name = "track_piece";

    const heatmapMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444, // Base track color
    });

    // Inject custom logic into the standard material
    heatmapMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uContactPoints = trackUniforms.uContactPoints;
      shader.uniforms.uNumPoints = trackUniforms.uNumPoints;
      shader.uniforms.uRadius = trackUniforms.uRadius;

      // Define uniforms in the shader code
      shader.fragmentShader =
        `
        uniform vec3 uContactPoints[80];
        uniform int uNumPoints;
        uniform float uRadius;
        varying vec3 vWorldPosition;
      ` + shader.fragmentShader;

      // Calculate heatmap brightness based on distance
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        
        float railIntensity = 0.0;
  float supportIntensity = 0.0;
  
  // Phase 1: Sharp Core for Steel
  float railCore = uRadius * 0.5; 
  // Phase 2: Spread out for Sleepers
  float supportCore = uRadius ; 

  for (int i = 0; i < 200; i++) {
      if (i >= uNumPoints) break;
      float dist = distance(vWorldPosition, uContactPoints[i]);
      
      // Calculate both distributions
      railIntensity += 1.0 / (1.1 + pow(dist / railCore, 2.0));
      supportIntensity += 1.0 / (1.5 + pow(dist / supportCore, 2.0));
  }

  // --- PHASE SWITCHING LOGIC ---
  float finalIntensity;
  
  // vWorldPosition.y is the vertical coordinate. 
  // We check if it's part of the 'Top' (Rail) or 'Bottom' (Sleeper)
  // Adjust -0.4 based on your specific track model's origin
  if (vWorldPosition.y > -0.4) {
      finalIntensity = railIntensity;
  } else {
      finalIntensity = supportIntensity;
  }

// Define the heatmap color stops
vec3 color1 = vec3(0.0, 0.0, 0.5); // Deep Blue (Cold)
vec3 color2 = vec3(0.0, 1.0, 1.0); // Cyan
vec3 color3 = vec3(0.0, 1.0, 0.0); // Green
vec3 color4 = vec3(1.0, 1.0, 0.0); // Yellow
vec3 color5 = vec3(1.0, 0.5, 0.0); // Orange (New!)
vec3 color6 = vec3(1.0, 0.0, 0.0); // Red
vec3 color7 = vec3(0.4, 0.1, 0.0); // Brownish Red (Extreme Heat)

vec3 heatColor;

// Multi-stage linear interpolation based on intensity
if (finalIntensity < 0.15) heatColor = mix(color1, color2, finalIntensity / 0.15);
  else if (finalIntensity < 0.3) heatColor = mix(color2, color3, (finalIntensity - 0.15) / 0.15);
  else if (finalIntensity < 0.45) heatColor = mix(color3, color4, (finalIntensity - 0.3) / 0.15);
  else if (finalIntensity < 0.6) heatColor = mix(color4, color5, (finalIntensity - 0.45) / 0.15);
  else if (finalIntensity < 0.8) heatColor = mix(color5, color6, (finalIntensity - 0.6) / 0.2);
  else heatColor = mix(color6, color7, clamp((finalIntensity - 0.8) / 0.7, 0.0, 1.0));

// Apply to the final fragment
diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.8);
        `,
      );

      // We need the world position in the fragment shader
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
    };

    originalModel.traverse((child) => {
      if (child.isMesh) {
        child.material = heatmapMaterial;
        child.name = "track_piece";
      }
    });

    const box = new THREE.Box3().setFromObject(originalModel);
    const pieceLength = box.max.x - box.min.x;

    const numberOfPieces = Math.ceil(length / pieceLength);

    // C. Repeating Loop
    for (let i = 0; i < numberOfPieces; i++) {
      const trackClone = originalModel.clone();

      const startX = x - length / 2 + pieceLength / 2;
      trackClone.position.set(startX + i * pieceLength, y - 0.9, z - 0.6);

      scene.add(trackClone);
    }
  });
};
