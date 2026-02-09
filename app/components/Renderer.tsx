import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { useEffect } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import CannonDebugger from "cannon-es-debugger";
import SceneInit from "./lib/SceneInit";
import { createTrackSegment } from "./Track";
import { createTrainCompartment } from "./Train";
import { trackUniforms } from "./Track";
import { useRef, useState } from "react";
import { MiniGraph } from "./MiniGraph";

// A JS implementation of the GLSL bending stress formula
function getBendingStress(dist, l, force) {
  const x = Math.abs(dist);
  const bracket = Math.sin(x / l) - Math.cos(x / l);
  const exponent = Math.exp(-x / l);
  // Invert the result to align with visual expectation (compression = hot, relief = cool)
  return -0.25 * force * l * exponent * bracket;
}

// A new, comprehensive function to get the intensity at a point, mirroring the shaders
function getHeatInfo(
  targetPoint,
  wheelPositions,
  wheelCount,
  targetType,
  lChar,
  P,
  stressScale,
) {
  let finalIntensity = 0;

  if (targetType === "rail") {
    let totalStress = 0;
    for (let i = 0; i < wheelCount; i++) {
      const wheelPos = wheelPositions[i];
      const dist = targetPoint.x - wheelPos.x;
      if (Math.abs(targetPoint.z - wheelPos.z) < 2.0 && Math.abs(dist) < 50.0) {
        totalStress += getBendingStress(dist, lChar, P);
      }
    }

    if (totalStress < 0.0) {
      // For rails, negative stress is blue, but for the inspector we can show it as 0
      finalIntensity = 0;
    } else {
      finalIntensity = totalStress * stressScale;
    }
  } else if (targetType === "sleeper") {
    // Replicates the final "projection" model for sleepers
    let stressLeft = 0;
    let stressRight = 0;
    for (let i = 0; i < wheelCount; i++) {
      const wheelPos = wheelPositions[i];
      const distX = targetPoint.x - wheelPos.x;
      if (Math.abs(distX) < 50.0) {
        if (wheelPos.z > 0.0) {
          stressLeft += getBendingStress(distX, lChar, P);
        } else {
          stressRight += getBendingStress(distX, lChar, P);
        }
      }
    }

    const baseStressX = Math.max(0.0, Math.max(stressLeft, stressRight));
    const railZPosition = 3.0;
    const distToNearestRail = Math.min(
      Math.abs(targetPoint.z - railZPosition),
      Math.abs(targetPoint.z + railZPosition),
    );
    const zFalloff =
      1.0 - THREE.MathUtils.smoothstep(0.0, 2.5, distToNearestRail);
    finalIntensity = baseStressX * 0.6 * zFalloff * stressScale * 1.5;
  }

  // This pressure value is just an approximation for the UI display
  const pressureMPa = finalIntensity * 500;

  return { intensity: finalIntensity, pressureMPa };
}

function getRailColor(intensity) {
  const color1 = new THREE.Color(0x000080); // Deep Blue
  const color2 = new THREE.Color(0x00ffff); // Cyan
  const color3 = new THREE.Color(0x00ff00); // Green
  const color4 = new THREE.Color(0xffff00); // Yellow
  const color5 = new THREE.Color(0xff0000); // Red
  const color6 = new THREE.Color(0.4, 0.1, 0.0); // Brownish Red (matches shader)

  const finalColor = new THREE.Color();

  if (intensity < 0.15) {
    finalColor.lerpColors(color1, color2, intensity / 0.15);
  } else if (intensity < 0.3) {
    finalColor.lerpColors(color2, color3, (intensity - 0.15) / 0.15);
  } else if (intensity < 0.45) {
    finalColor.lerpColors(color3, color4, (intensity - 0.3) / 0.15);
  } else if (intensity < 0.6) {
    finalColor.lerpColors(color4, color5, (intensity - 0.45) / 0.15);
  } else if (intensity < 0.8) {
    finalColor.lerpColors(color5, color6, (intensity - 0.6) / 0.2);
  } else {
    const factor = Math.min((intensity - 0.8) / 0.7, 1.0);
    finalColor.lerpColors(color6, color6, factor); // Stays at color6
  }
  return finalColor;
}

// Sleeper now uses the same color ramp as the rail
function getSleeperColor(intensity) {
  return getRailColor(intensity);
}

function App() {
  const [currentIntensity, setCurrentIntensity] = useState(0);
  const inspectorTargetType = useRef(null);
  const graphDataRef = useRef([]);
  useEffect(() => {
    const test = new SceneInit("myThreeJsCanvas");
    test.initialize();
    test.animate();
    const axesHelper = new THREE.AxesHelper(8);
    test.scene.add(axesHelper);

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const cannonDebugger = new CannonDebugger(test.scene, world);

    // Add a large ground plane
    const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
    const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    planeMesh.rotation.x = -Math.PI / 2; // Rotate to lay flat
    planeMesh.position.y = -0.5; // Position below the track
    planeMesh.receiveShadow = true; // Allow it to receive shadows
    test.scene.add(planeMesh);

    // Create Track and Train
    // NOTE: Change this value to scale the track model
    const trackScale = 3.7;
    // NOTE: Change this value to visually move the track model up or down
    const trackVisualYOffset = 0.4;
    createTrackSegment(
      test.scene,
      world,
      0,
      0,
      0,
      800,
      trackScale,
      trackVisualYOffset,
    );
    // ============
    // Create Multiple Train Carts
    // ============
    const carts = [];
    const numberOfCarts = 10;
    const pointslength = 80;
    const spacing = 30; // Ensure they don't overlap on spawn

    const loader = new GLTFLoader();

    Promise.all([
      loader.loadAsync("/assets/train/chassis1.glb"),
      loader.loadAsync("/assets/train/wheel1.glb"),
    ]).then(([chassisGltf, wheelGltf]) => {
      const chassisModel = chassisGltf.scene;
      chassisModel.scale.set(50, 50, 50); // Scale up by 50 times

      const wheelModel = wheelGltf.scene;
      wheelModel.scale.set(50, 50, 50); // Scale up by 50 times

      for (let i = 0; i < numberOfCarts; i++) {
        const spawnX = i * -spacing;
        const newCart = createTrainCompartment(
          test.scene,
          world,
          new CANNON.Vec3(spawnX, 5, 0),
          chassisModel,
          wheelModel,
        );
        carts.push(newCart);
      }

      // Create joints between carts
      for (let i = 0; i < carts.length - 1; i++) {
        const leader = carts[i].chassisBody;
        const follower = carts[i + 1].chassisBody;

        // The trainLength is 26, so the edge is at 13.
        // We add a tiny bit of extra space (0.5) to prevent collisions.
        const pivotOffset = 13.5;

        const joint = new CANNON.PointToPointConstraint(
          leader,
          new CANNON.Vec3(-pivotOffset, 0, 0), // Back of leader (Negative X)
          follower,
          new CANNON.Vec3(pivotOffset, 0, 0), // Front of follower (Positive X)
        );

        world.addConstraint(joint);
      }
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    // Initialization
    const inspectorSphereGeo = new THREE.SphereGeometry(0.2); // Make it big enough to see
    const inspectorSphereMat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      depthTest: true,
      transparent: false,
      opacity: 1.0,
    });

    const inspectorSphere = new THREE.Mesh(
      inspectorSphereGeo,
      inspectorSphereMat,
    );
    inspectorSphere.renderOrder = 0; // Force it to draw on top of everything
    inspectorSphere.visible = false;
    test.scene.add(inspectorSphere);
    inspectorSphere.frustumCulled = false;

    window.addEventListener("pointerdown", (event) => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, test.camera);
      const intersects = raycaster.intersectObjects(test.scene.children, true);
      const trackHit = intersects.find(
        (hit) => hit.object.name === "rail" || hit.object.name === "sleeper",
      );
      if (trackHit) {
        console.log("Hit Target:", trackHit.object.name); // Check if this says 'sleeper' when you click the rail
        const clickedPoint = trackHit.point;
        inspectorTargetType.current = trackHit.object.name;
        inspectorSphere.position.copy(clickedPoint);
        inspectorSphere.visible = true;
      }
    });

    // Input Handling
    const maxspeed = 900;
    const handleKey = (e: KeyboardEvent, isDown: boolean) => {
      const force = isDown ? maxspeed : 0;
      if (e.key === "w" || e.key === "ArrowUp") {
        carts[0].vehicle.setWheelForce(force, 0);
        carts[0].vehicle.setWheelForce(force, 1);
        carts[0].vehicle.setWheelForce(force, 2);
        carts[0].vehicle.setWheelForce(force, 3);
      }
      if (e.key === "s" || e.key === "ArrowDown") {
        carts[0].vehicle.setWheelForce(isDown ? -force / 2 : 0, 0);
        carts[0].vehicle.setWheelForce(isDown ? -force / 2 : 0, 1);
        carts[0].vehicle.setWheelForce(isDown ? -force / 2 : 0, 2);
        carts[0].vehicle.setWheelForce(isDown ? -force / 2 : 0, 3);
      }
    };

    window.addEventListener("keydown", (e) => handleKey(e, true));
    window.addEventListener("keyup", (e) => handleKey(e, false));

    // Contact Points setup
    const contactPoints: THREE.Mesh[] = Array.from(
      { length: pointslength },
      () => {
        const p = new THREE.Mesh(
          new THREE.SphereGeometry(0.1),
          new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        );
        p.visible = false;
        test.scene.add(p);
        return p;
      },
    );

    let frameCount = 0;

    const animate = () => {
      frameCount++;
      world.fixedStep();
      cannonDebugger.update();
      carts.forEach((cart) => cart.update());

      // Make the directional light follow the train
      if (carts.length > 0) {
        const leadCartBody = carts[0].chassisBody;
        const light = test.directionalLight;
        const lightTarget = test.directionalLight.target;

        // Set the target's position to the lead cart's position
        lightTarget.position.copy(leadCartBody.position);

        // Update the light's position to be offset from the cart
        light.position
          .copy(leadCartBody.position)
          .add(new THREE.Vector3(20, 40, 40));

        // Add the target to the scene if it's not already there
        if (!lightTarget.parent) {
          test.scene.add(lightTarget);
        }

        lightTarget.updateMatrixWorld();
      }

      // --- NEW: Update Wheel Positions for Shader ---
      const wheelPositions = [];
      carts.forEach((cart) => {
        cart.vehicle.wheelBodies.forEach((wheelBody) => {
          // Convert Cannon.js Vec3 to Three.js Vector3
          const wheelPos = new THREE.Vector3(
            wheelBody.position.x,
            wheelBody.position.y,
            wheelBody.position.z,
          );
          wheelPositions.push(wheelPos);
        });
      });

      trackUniforms.uWheelCount.value = wheelPositions.length;
      // Pad the array to match the fixed size expected by the shader
      trackUniforms.uWheelPositions.value = [
        ...wheelPositions,
        ...new Array(pointslength - wheelPositions.length).fill(
          new THREE.Vector3(0, -1000, 0), // Place unused points far away
        ),
      ];

      // --- OLD Contact Points Logic (for inspector sphere) ---
      const points = [];
      world.contacts.forEach((contact) => {
        const worldPos = new CANNON.Vec3();
        contact.bi.position.vadd(contact.ri, worldPos);
        points.push(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z));
      });

      if (inspectorSphere.visible) {
        // Re-calculate intensity every frame with the new, accurate logic
        const { intensity, pressureMPa } = getHeatInfo(
          inspectorSphere.position,
          trackUniforms.uWheelPositions.value,
          trackUniforms.uWheelCount.value,
          inspectorTargetType.current,
          trackUniforms.uLChar.value,
          trackUniforms.uP.value,
          trackUniforms.uStressScale.value,
        );

        let finalColor;
        if (inspectorTargetType.current === "rail") {
          finalColor = getRailColor(intensity);
        } else {
          finalColor = getSleeperColor(intensity);
        }

        // Update visuals
        inspectorSphere.material.color.copy(finalColor);
        inspectorSphere.renderOrder = 999;

        if (frameCount % 5 === 0) {
          setCurrentIntensity(pressureMPa); // Use pressure for display

          // Add to graph data
          graphDataRef.current.push({
            time: Date.now(),
            value: pressureMPa,
          });

          // Keep only the last 100 points
          if (graphDataRef.current.length > 100) {
            graphDataRef.current.shift();
          }
        }
      }
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <canvas id="myThreeJsCanvas" />

      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          padding: "10px",
          background: "rgba(0,0,0,0.8)",
          color: "white",
          fontFamily: "monospace",
          borderRadius: "8px",
        }}
      >
        <div>Pressure(MPa): {currentIntensity.toFixed(4)}</div>
        {/* Pass the Ref here! */}
        <MiniGraph dataRef={graphDataRef} />
      </div>
    </div>
  );
}

export default App;
