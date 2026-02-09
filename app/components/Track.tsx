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
      shader.uniforms.uContactPoints = trackUniforms.uContactPoints;
      shader.uniforms.uNumPoints = trackUniforms.uNumPoints;
      shader.uniforms.uRadius = trackUniforms.uRadius;

      shader.fragmentShader = `
        uniform vec3 uContactPoints[80];
        uniform int uNumPoints;
        uniform float uRadius;
        varying vec3 vWorldPosition;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        
        float finalIntensity = 0.0;
        float railCore = uRadius * 0.5; 

        for (int i = 0; i < uNumPoints; i++) {
            float dist = distance(vWorldPosition, uContactPoints[i]);
            finalIntensity += 1.0 / (1.1 + pow(dist / railCore, 2.0));
        }

        vec3 color1 = vec3(0.0, 0.0, 0.5); // Deep Blue
        vec3 color2 = vec3(0.0, 1.0, 1.0); // Cyan
        vec3 color3 = vec3(0.0, 1.0, 0.0); // Green
        vec3 color4 = vec3(1.0, 1.0, 0.0); // Yellow
        vec3 color5 = vec3(1.0, 0.0, 0.0); // Red
        vec3 color6 = vec3(0.4, 0.1, 0.0); // Brownish Red

        vec3 heatColor;
        if (finalIntensity < 0.15) heatColor = mix(color1, color2, finalIntensity / 0.15);
        else if (finalIntensity < 0.3) heatColor = mix(color2, color3, (finalIntensity - 0.15) / 0.15);
        else if (finalIntensity < 0.45) heatColor = mix(color3, color4, (finalIntensity - 0.3) / 0.15);
        else if (finalIntensity < 0.6) heatColor = mix(color4, color5, (finalIntensity - 0.45) / 0.15);
        else if (finalIntensity < 0.8) heatColor = mix(color5, color6, (finalIntensity - 0.6) / 0.2);
        else heatColor = mix(color6, color6, clamp((finalIntensity - 0.8) / 0.7, 0.0, 1.0));

        diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.9);
        `,
      );

      shader.vertexShader = `
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
    
    // --- Sleeper Material (Simpler Heatmap) ---
    const sleeperMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555, // Slightly lighter base color
    });
    sleeperMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uContactPoints = trackUniforms.uContactPoints;
        shader.uniforms.uNumPoints = trackUniforms.uNumPoints;
        shader.uniforms.uRadius = trackUniforms.uRadius;
  
        shader.fragmentShader =
          `
          uniform vec3 uContactPoints[80];
          uniform int uNumPoints;
          uniform float uRadius;
          varying vec3 vWorldPosition;
        ` + shader.fragmentShader;
  
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `
          #include <color_fragment>
          
          float finalIntensity = 0.0;
          float supportCore = uRadius; // More spread out
  
          for (int i = 0; i < uNumPoints; i++) {
              float dist = distance(vWorldPosition, uContactPoints[i]);
              finalIntensity += 1.0 / (1.5 + pow(dist / supportCore, 2.0));
          }
  
          vec3 color1 = vec3(0.1, 0.0, 0.2); // Faint Purple
          vec3 color2 = vec3(1.0, 0.5, 0.0); // Orange
  
          vec3 heatColor = mix(color1, color2, clamp(finalIntensity * 0.5, 0.0, 1.0));

          diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, 0.8);
          `,
        );
  
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

    // Apply materials
    railModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.name = "rail";
        child.material = railMaterial;
        child.receiveShadow = true;
      }
    });
    sleepersModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.name = "sleeper";
          child.material = sleeperMaterial;
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
      trackClone.position.set(startX + i * pieceLength, y + trackVisualYOffset, z);
      trackClone.rotation.y += Math.PI / 2; // Apply additional 90-degree rotation

      scene.add(trackClone);
    }
  });
};
