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
import { StatsWidget } from "./StatsWidget";

const CONFIG = {
  PIEZO_THICKNESS: 0.1, // Unified thickness value (5mm)
  PIEZO_VOLTAGE_CONSTANT: 0.02, // Vm/N or Vm/Pa
  PIEZO_CAPACITANCE: 0,

  // Constants for capacitance calculation
  PIEZO_EPSILON_R: 1300,
  PIEZO_EPSILON_0: 8.854e-12, // Vacuum permittivity
  PIEZO_AREA: 0.01, // 10cm x 10cm = 0.01 m^2

  HEAT_INFO: {
    Z_AXIS_DISTANCE_CHECK: 2.0,
    X_AXIS_DISTANCE_CHECK: 50.0,
  },
  HEATMAP_COLOR: {
    COLOR1: new THREE.Color(0x000080), // Deep Blue
    COLOR2: new THREE.Color(0x00ffff), // Cyan
    COLOR3: new THREE.Color(0x00ff00), // Green
    COLOR4: new THREE.Color(0xffff00), // Yellow
    COLOR5: new THREE.Color(0xff0000), // Red
    COLOR6: new THREE.Color(0.4, 0.1, 0.0), // Brownish Red (matches shader)
    INTENSITY_THRESHOLDS: {
      T1: 0.15,
      T2: 0.3,
      T3: 0.45,
      T4: 0.6,
      T5: 0.8,
    },
  },
  RAIL_COLOR: {
    RELIEF_INTENSITY_MULTIPLIER: 2.0,
    RELIEF_COLOR1: new THREE.Color(0.05, 0.05, 0.05), // Corresponds to vec3(0.05)
    RELIEF_COLOR2: new THREE.Color(0.0, 0.5, 1.0), // Corresponds to vec3(0.0, 0.5, 1.0)
  },
  SLEEPER_COLOR: {
    INTENSITY_MULTIPLIER_1: 0.6,
    INTENSITY_MULTIPLIER_2: 1.5,
  },
  APP: {
    GRAVITY: -9.82,
    AXES_HELPER_SIZE: 8,
    PLANE_GEOMETRY_SIZE: 2000,
    PLANE_MESH_POSITION_Y: -0.5,
    TRACK_SCALE: 3.7,
    TRACK_VISUAL_Y_OFFSET: 0.4,
    TRACK_LENGTH: 800,
    NUMBER_OF_CARTS: 10,
    POINTS_LENGTH: 80,
    CART_SPACING: 30,
    CHASSIS_MODEL_SCALE: 50,
    WHEEL_MODEL_SCALE: 50,
    PIVOT_OFFSET: 13.5,
    INSPECTOR_SPHERE_SIZE: 0.2,
    MAX_SPEED: 1500,
    LIGHT_POSITION_OFFSET: new THREE.Vector3(20, 40, 40),
    UNUSED_POINTS_Y_POSITION: -1000,
    GRAPH_UPDATE_FREQUENCY: 5, // every 5 frames
    GRAPH_DATA_POINTS: 100,
    STRESS_GRAPH: {
      MIN_VAL: -900000,
      MAX_VAL: 900000,
    },
    VOLTAGE_GRAPH: {
      MIN_VAL: -1500.0,
      MAX_VAL: 1500.0,
    },
    CURRENT_GRAPH: {
      MIN_VAL: -0.1,
      MAX_VAL: 0.1,
    },
    POWER_GRAPH: {
      MIN_VAL: -10,
      MAX_VAL: 10,
    },
    L_CHAR: 13,
    P: 125000.0,
    RAIL_Z_POSITION: 3.0,
    SLEEPER_FALLOFF_SPREAD_INNER: 6.0,
    SLEEPER_FALLOFF_SPREAD_OUTER: 4.0,
  },
  // Artificial multipliers for tuning
  ARTIFICIAL_CAPACITANCE_MULTIPLIER: 25, // Multiplies calculated C to ~100nF
  ARTIFICIAL_CURRENT_MULTIPLIER: 25,
};

CONFIG.PIEZO_CAPACITANCE =
  ((CONFIG.PIEZO_EPSILON_R * CONFIG.PIEZO_EPSILON_0 * CONFIG.PIEZO_AREA) /
    CONFIG.PIEZO_THICKNESS) *
  CONFIG.ARTIFICIAL_CAPACITANCE_MULTIPLIER;

// A JS implementation of the GLSL bending stress formula
function getBendingStress(dist, l, force) {
  const x = Math.abs(dist);
  const bracket = Math.sin(x / l) - Math.cos(x / l);
  const exponent = Math.exp(-x / l);
  // Invert the result to align with visual expectation (compression = hot, relief = cool)
  return -0.25 * force * l * exponent * bracket;
}

// JS implementation of GLSL's smoothstep
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
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
  let rawStress = 0;
  let pressureMPa = 0;

  if (targetType === "rail") {
    let totalStress = 0;
    for (let i = 0; i < wheelCount; i++) {
      const wheelPos = wheelPositions[i];
      const dist = targetPoint.x - wheelPos.x;
      if (
        Math.abs(targetPoint.z - wheelPos.z) <
          CONFIG.HEAT_INFO.Z_AXIS_DISTANCE_CHECK &&
        Math.abs(dist) < CONFIG.HEAT_INFO.X_AXIS_DISTANCE_CHECK
      ) {
        totalStress += getBendingStress(dist, lChar, P);
      }
    }
    rawStress = totalStress;
    pressureMPa = rawStress;
  } else if (targetType === "sleeper") {
    let stressLeft = 0;
    let stressRight = 0;
    for (let i = 0; i < wheelCount; i++) {
      const wheelPos = wheelPositions[i];
      const distX = targetPoint.x - wheelPos.x;
      if (Math.abs(distX) < CONFIG.HEAT_INFO.X_AXIS_DISTANCE_CHECK) {
        // Left rail is on the +Z side, Right rail is on the -Z side
        if (wheelPos.z > 0.0) {
          stressLeft += getBendingStress(distX, lChar, P);
        } else {
          stressRight += getBendingStress(distX, lChar, P);
        }
      }
    }
    const baseStressX =
      Math.abs(stressLeft) > Math.abs(stressRight) ? stressLeft : stressRight;

    const railZPosition = CONFIG.APP.RAIL_Z_POSITION;
    const distToNearestRail = Math.min(
      Math.abs(targetPoint.z - railZPosition),
      Math.abs(targetPoint.z + railZPosition),
    );

    let falloffSpread;
    if (Math.abs(targetPoint.z) < railZPosition) {
      falloffSpread = CONFIG.APP.SLEEPER_FALLOFF_SPREAD_INNER;
    } else {
      falloffSpread = CONFIG.APP.SLEEPER_FALLOFF_SPREAD_OUTER;
    }

    const zFalloff = 1.0 - smoothstep(0.0, falloffSpread, distToNearestRail);

    const modulatedStress = baseStressX * zFalloff;
    rawStress = modulatedStress;
    pressureMPa = rawStress;
  }

  // Calculate piezoVoltage
  const piezoVoltage =
    rawStress * CONFIG.PIEZO_THICKNESS * CONFIG.PIEZO_VOLTAGE_CONSTANT;

  return { rawStress, pressureMPa, piezoVoltage };
}

function getHeatmapColor(finalIntensity) {
  const finalColor = new THREE.Color();
  const thresholds = CONFIG.HEATMAP_COLOR.INTENSITY_THRESHOLDS;

  if (finalIntensity < thresholds.T1) {
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR1,
      CONFIG.HEATMAP_COLOR.COLOR2,
      finalIntensity / thresholds.T1,
    );
  } else if (finalIntensity < thresholds.T2) {
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR2,
      CONFIG.HEATMAP_COLOR.COLOR3,
      (finalIntensity - thresholds.T1) / (thresholds.T2 - thresholds.T1),
    );
  } else if (finalIntensity < thresholds.T3) {
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR3,
      CONFIG.HEATMAP_COLOR.COLOR4,
      (finalIntensity - thresholds.T2) / (thresholds.T3 - thresholds.T2),
    );
  } else if (finalIntensity < thresholds.T4) {
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR4,
      CONFIG.HEATMAP_COLOR.COLOR5,
      (finalIntensity - thresholds.T3) / (thresholds.T4 - thresholds.T3),
    );
  } else if (finalIntensity < thresholds.T5) {
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR5,
      CONFIG.HEATMAP_COLOR.COLOR6,
      (finalIntensity - thresholds.T4) / (thresholds.T5 - thresholds.T4),
    );
  } else {
    const factor = Math.min(
      (finalIntensity - thresholds.T5) / (1.0 - thresholds.T5),
      1.0,
    );
    finalColor.lerpColors(
      CONFIG.HEATMAP_COLOR.COLOR6,
      CONFIG.HEATMAP_COLOR.COLOR6,
      factor,
    ); // Stays at color6
  }
  return finalColor;
}

function getRailColor(rawStress, stressScale) {
  if (rawStress < 0) {
    const finalColor = new THREE.Color();
    // Negative stress (relief) is visualized as blue
    const reliefIntensity =
      Math.abs(rawStress) *
      stressScale *
      CONFIG.RAIL_COLOR.RELIEF_INTENSITY_MULTIPLIER;
    finalColor.lerpColors(
      CONFIG.RAIL_COLOR.RELIEF_COLOR1,
      CONFIG.RAIL_COLOR.RELIEF_COLOR2,
      Math.max(0.0, Math.min(reliefIntensity, 1.0)),
    ); // Clamp alpha
    return finalColor;
  }
  // Positive stress (compression) uses the multi-color heatmap
  const finalIntensity = rawStress * stressScale;
  return getHeatmapColor(finalIntensity);
}

// Sleeper now uses the same color ramp as the rail
function getSleeperColor(rawStress, stressScale) {
  if (rawStress < 0) {
    // Same relief logic as rail
    return getRailColor(rawStress, stressScale);
  }
  // Positive stress (compression) uses the multi-color heatmap
  const finalIntensity =
    rawStress *
    CONFIG.SLEEPER_COLOR.INTENSITY_MULTIPLIER_1 *
    stressScale *
    CONFIG.SLEEPER_COLOR.INTENSITY_MULTIPLIER_2;
  return getHeatmapColor(finalIntensity);
}

function App() {
  const [currentIntensity, setCurrentIntensity] = useState(0);
  const [currentVoltage, setCurrentVoltage] = useState(0);
  const [currentCurrent, setCurrentCurrent] = useState(0);
  const [currentPower, setCurrentPower] = useState(0);
  const [maxStress, setMaxStress] = useState(0);
  const [maxVoltage, setMaxVoltage] = useState(0);
  const [maxCurrent, setMaxCurrent] = useState(0);
  const [maxPower, setMaxPower] = useState(0);
  const [cumulativeEnergy, setCumulativeEnergy] = useState(0);

  const inspectorTargetType = useRef(null);

  const cumulativeEnergyRef = useRef(0);

  const graphDataRef = useRef([]);

  const voltageGraphDataRef = useRef([]);
  const currentGraphDataRef = useRef([]);
  const powerGraphDataRef = useRef([]);

  const previousVoltageRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const test = new SceneInit("myThreeJsCanvas");
    test.initialize();
    test.animate();
    const axesHelper = new THREE.AxesHelper(CONFIG.APP.AXES_HELPER_SIZE);
    test.scene.add(axesHelper);
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, CONFIG.APP.GRAVITY, 0),
    });
    const cannonDebugger = new CannonDebugger(test.scene, world);

    // Add a large ground plane
    const planeGeometry = new THREE.PlaneGeometry(
      CONFIG.APP.PLANE_GEOMETRY_SIZE,
      CONFIG.APP.PLANE_GEOMETRY_SIZE,
    );

    const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    planeMesh.rotation.x = -Math.PI / 2; // Rotate to lay flat
    planeMesh.position.y = CONFIG.APP.PLANE_MESH_POSITION_Y; // Position below the track
    planeMesh.receiveShadow = true; // Allow it to receive shadows
    test.scene.add(planeMesh);

    // Create Track and Train
    createTrackSegment(
      test.scene,
      world,
      0,
      0,
      0,
      CONFIG.APP.TRACK_LENGTH,
      CONFIG.APP.TRACK_SCALE,
      CONFIG.APP.TRACK_VISUAL_Y_OFFSET,
    );
    // ============
    // Create Multiple Train Carts
    // ============
    const carts = [];
    const numberOfCarts = CONFIG.APP.NUMBER_OF_CARTS;
    const pointslength = CONFIG.APP.POINTS_LENGTH;
    const spacing = CONFIG.APP.CART_SPACING; // Ensure they don't overlap on spawn
    const loader = new GLTFLoader();

    Promise.all([
      loader.loadAsync("/assets/train/chassis1.glb"),

      loader.loadAsync("/assets/train/wheel1.glb"),
    ]).then(([chassisGltf, wheelGltf]) => {
      const chassisModel = chassisGltf.scene;

      chassisModel.scale.set(
        CONFIG.APP.CHASSIS_MODEL_SCALE,

        CONFIG.APP.CHASSIS_MODEL_SCALE,

        CONFIG.APP.CHASSIS_MODEL_SCALE,
      ); // Scale up by 50 times

      const wheelModel = wheelGltf.scene;

      wheelModel.scale.set(
        CONFIG.APP.WHEEL_MODEL_SCALE,

        CONFIG.APP.WHEEL_MODEL_SCALE,

        CONFIG.APP.WHEEL_MODEL_SCALE,
      ); // Scale up by 50 times

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
        const pivotOffset = CONFIG.APP.PIVOT_OFFSET;
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
    const inspectorSphereGeo = new THREE.SphereGeometry(
      CONFIG.APP.INSPECTOR_SPHERE_SIZE,
    ); // Make it big enough to see
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
        setMaxStress(0);
        setMaxVoltage(0);
        setMaxCurrent(0);
        setMaxPower(0);
        setCumulativeEnergy(0);
        cumulativeEnergyRef.current = 0;
        previousVoltageRef.current = 0;
        lastTimeRef.current = 0;
      }
    });

    // Input Handling

    const maxspeed = CONFIG.APP.MAX_SPEED;

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

          .add(CONFIG.APP.LIGHT_POSITION_OFFSET);

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
          new THREE.Vector3(0, CONFIG.APP.UNUSED_POINTS_Y_POSITION, 0), // Place unused points far away
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
        const { pressureMPa, piezoVoltage } = getHeatInfo(
          inspectorSphere.position,
          trackUniforms.uWheelPositions.value,
          trackUniforms.uWheelCount.value,
          inspectorTargetType.current,
          CONFIG.APP.L_CHAR,
          CONFIG.APP.P,
          trackUniforms.uStressScale.value,
        );

        const { rawStress } = getHeatInfo(
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
          finalColor = getRailColor(
            rawStress,
            trackUniforms.uStressScale.value,
          );
        } else {
          finalColor = getSleeperColor(
            rawStress,
            trackUniforms.uStressScale.value,
          );
        }

        // Update visuals
        inspectorSphere.material.color.copy(finalColor);
        inspectorSphere.renderOrder = 999;

        // --- New: Calculate Current and Power ---
        const currentTime = performance.now() / 1000; // time in seconds
        const dt =
          lastTimeRef.current > 0 ? currentTime - lastTimeRef.current : 0;
        const dV = piezoVoltage - previousVoltageRef.current;

        const piezoCurrent =
          dt > 0
            ? CONFIG.PIEZO_CAPACITANCE *
              (dV / dt) *
              CONFIG.ARTIFICIAL_CURRENT_MULTIPLIER
            : 0;
        const piezoPower = piezoVoltage * piezoCurrent;

        // Accumulate energy (Joules = Watts * seconds)
        if (dt > 0) {
          const energySlice = Math.abs(piezoPower * dt);
          cumulativeEnergyRef.current += energySlice;
        }

        // Update refs for next frame's calculation
        previousVoltageRef.current = piezoVoltage;
        lastTimeRef.current = currentTime;

        if (frameCount % CONFIG.APP.GRAPH_UPDATE_FREQUENCY === 0) {
          setCumulativeEnergy(cumulativeEnergyRef.current);
          setCurrentIntensity(pressureMPa); // Use pressure for display
          setCurrentVoltage(piezoVoltage);
          setCurrentCurrent(piezoCurrent);
          setCurrentPower(piezoPower);

          setMaxStress((prevMax) => Math.max(prevMax, pressureMPa));
          setMaxVoltage((prevMax) => Math.max(prevMax, Math.abs(piezoVoltage)));
          setMaxCurrent((prevMax) => Math.max(prevMax, Math.abs(piezoCurrent)));
          setMaxPower((prevMax) => Math.max(prevMax, Math.abs(piezoPower)));

          // Add to graph data
          graphDataRef.current.push({ time: Date.now(), value: pressureMPa });
          voltageGraphDataRef.current.push({
            time: Date.now(),
            value: piezoVoltage,
          });
          currentGraphDataRef.current.push({
            time: Date.now(),
            value: piezoCurrent,
          });
          powerGraphDataRef.current.push({
            time: Date.now(),
            value: piezoPower,
          });

          // Keep only the last N points
          const refsToTrim = [
            graphDataRef,
            voltageGraphDataRef,
            currentGraphDataRef,
            powerGraphDataRef,
          ];
          refsToTrim.forEach((ref) => {
            if (ref.current.length > CONFIG.APP.GRAPH_DATA_POINTS) {
              ref.current.shift();
            }
          });
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

          left: 20,

          padding: "10px",

          background: "rgba(0,0,0,0.8)",

          color: "white",

          fontFamily: "monospace",

          borderRadius: "8px",
        }}
      >
        <div>Raw Stress: {currentIntensity.toFixed(4)}</div>

        {/* Pass the Ref here! */}

        <MiniGraph
          dataRef={graphDataRef}
          minVal={CONFIG.APP.STRESS_GRAPH.MIN_VAL}
          maxVal={CONFIG.APP.STRESS_GRAPH.MAX_VAL}
        />

        <div style={{ marginTop: "10px" }}>
          Voltage (V): {currentVoltage.toFixed(6)}
        </div>

        <MiniGraph
          dataRef={voltageGraphDataRef}
          minVal={CONFIG.APP.VOLTAGE_GRAPH.MIN_VAL}
          maxVal={CONFIG.APP.VOLTAGE_GRAPH.MAX_VAL}
        />
        <div style={{ marginTop: "10px" }}>
          Current (A): {currentCurrent.toExponential(4)}
        </div>
        <MiniGraph
          dataRef={currentGraphDataRef}
          minVal={CONFIG.APP.CURRENT_GRAPH.MIN_VAL}
          maxVal={CONFIG.APP.CURRENT_GRAPH.MAX_VAL}
        />

        <div style={{ marginTop: "10px" }}>
          Power (W): {currentPower.toExponential(4)}
        </div>
        <MiniGraph
          dataRef={powerGraphDataRef}
          minVal={CONFIG.APP.POWER_GRAPH.MIN_VAL}
          maxVal={CONFIG.APP.POWER_GRAPH.MAX_VAL}
        />
      </div>
      <StatsWidget
        stats={[
          { label: "Max Stress", value: maxStress, unit: "Pa" },
          { label: "Max Voltage", value: maxVoltage, unit: "V" },
          { label: "Max Current", value: maxCurrent, unit: "A" },
          { label: "Max Power", value: maxPower, unit: "W" },
          { label: "Cumulative Energy", value: cumulativeEnergy, unit: "J" },
          {
            label: "Piezo Thickness",
            value: CONFIG.PIEZO_THICKNESS,
            unit: "m",
          },
          {
            label: "Piezo V Constant",
            value: CONFIG.PIEZO_VOLTAGE_CONSTANT,
            unit: "Vm/N",
          },
          {
            label: "Piezo Capacitance",
            value: CONFIG.PIEZO_CAPACITANCE,
            unit: "F",
            format: "exponential",
            precision: 3,
          },
          {
            label: "Piezo Epsilon R",
            value: CONFIG.PIEZO_EPSILON_R,
            unit: "",
          },
          {
            label: "Piezo Epsilon 0",
            value: CONFIG.PIEZO_EPSILON_0,
            unit: "F/m",
            format: "exponential",
            precision: 3,
          },
          {
            label: "Piezo Area",
            value: CONFIG.PIEZO_AREA,
            unit: "m²",
          },
        ]}
      />
    </div>
  );
}

export default App;
