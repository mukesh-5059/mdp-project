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

function getHeatAtPoint(targetPoint, contactPoints, radius) {
  let intensity = 0.0;
  const numPoints = trackUniforms.uNumPoints.value;

  // Determine which phase the inspector is in
  const isRail = targetPoint.y > -0.4;

  // Match the shader values
  const core = isRail ? radius * 0.5 : radius;
  const blur = isRail ? 1.1 : 1.5;

  for (let i = 0; i < numPoints; i++) {
    const cp = contactPoints[i];
    const dist = targetPoint.distanceTo(cp);
    intensity += 1.0 / (blur + Math.pow(dist / core, 2.0));
  }

  return Math.min(intensity, 2.0);
}

function App() {
  const [currentIntensity, setCurrentIntensity] = useState(0);
  const graphDataRef = useRef([]);
  useEffect(() => {
    const test = new SceneInit("myThreeJsCanvas");
    test.initialize();
    test.animate();
    const axesHelper = new THREE.AxesHelper(8);
    test.scene.add(axesHelper);

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    //const cannonDebugger = new CannonDebugger(test.scene, world);

    // Create Track and Train
    createTrackSegment(test.scene, world, 0, 0, 0, 1000);
    // ============
    // Create Multiple Train Carts
    // ============
    const carts = [];
    const numberOfCarts = 10;
    const pointslength = numberOfCarts * 8;
    const spacing = 20; // Ensure they don't overlap on spawn

    for (let i = 0; i < numberOfCarts; i++) {
      // Spawn each cart further back along the X axis
      const spawnX = i * -spacing;
      const newCart = createTrainCompartment(
        test.scene,
        world,
        new CANNON.Vec3(spawnX, 5, 0),
      );
      carts.push(newCart);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    // Initialization
    const inspectorSphereGeo = new THREE.SphereGeometry(0.2); // Make it big enough to see
    const inspectorSphereMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 1.0,
      depthTest: false, // Prevents track from "eating" the sphere
      transparent: true,
      opacity: 0.9,
    });

    const inspectorSphere = new THREE.Mesh(
      inspectorSphereGeo,
      inspectorSphereMat,
    );
    inspectorSphere.renderOrder = 999; // Force it to draw on top of everything
    inspectorSphere.visible = false;
    test.scene.add(inspectorSphere);
    inspectorSphere.frustumCulled = false;

    for (let i = 0; i < carts.length - 1; i++) {
      const leader = carts[i].chassisBody;
      const follower = carts[i + 1].chassisBody;

      // The trainLength is 16, so the edge is at 8.
      // We add a tiny bit of extra space (0.5) to prevent collisions.
      const pivotOffset = 8.5;

      const joint = new CANNON.PointToPointConstraint(
        leader,
        new CANNON.Vec3(-pivotOffset, 0, 0), // Back of leader (Negative X)
        follower,
        new CANNON.Vec3(pivotOffset, 0, 0), // Front of follower (Positive X)
      );

      world.addConstraint(joint);
    }

    window.addEventListener("pointerdown", (event) => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, test.camera);
      const intersects = raycaster.intersectObjects(test.scene.children, true);
      const trackHit = intersects.find(
        (hit) =>
          hit.object.name === "track_piece" ||
          hit.object.parent?.name === "track_piece",
      );

      if (trackHit) {
        const clickedPoint = trackHit.point;

        inspectorSphere.position.copy(clickedPoint);
        inspectorSphere.visible = true;
      }
    });

    // Input Handling
    const maxspeed = numberOfCarts * 30;
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
      //cannonDebugger.update();
      carts.forEach((cart) => cart.update());
      const points = [];
      // Update Contacts
      contactPoints.forEach((p) => (p.visible = false));
      world.contacts.forEach((contact, i) => {
        if (i < contactPoints.length) {
          const worldPos = new CANNON.Vec3();
          contact.bi.position.vadd(contact.ri, worldPos);
          contactPoints[i].position.set(worldPos.x, worldPos.y, worldPos.z);
          contactPoints[i].visible = true;
          points.push(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z));
        }
      });
      trackUniforms.uNumPoints.value = points.length;

      trackUniforms.uContactPoints.value = [
        ...points,
        ...new Array(pointslength - points.length).fill(
          new THREE.Vector3(0, -1000, 0),
        ),
      ];

      if (inspectorSphere.visible) {
        // Re-calculate intensity every frame based on moving wheels
        const currentIntensity = getHeatAtPoint(
          inspectorSphere.position,
          points,
          2.0,
        );
        const color1 = new THREE.Color(0x000080); // Deep Blue
        const color2 = new THREE.Color(0x00ffff); // Cyan
        const color3 = new THREE.Color(0x00ff00); // Green
        const color4 = new THREE.Color(0xffff00); // Yellow
        const color5 = new THREE.Color(0xff0000); // Red
        const color6 = new THREE.Color(0x660000); // Brownish Red

        let finalColor = new THREE.Color();

        if (currentIntensity < 0.2) {
          finalColor.lerpColors(color1, color2, currentIntensity / 0.2);
        } else if (currentIntensity < 0.4) {
          finalColor.lerpColors(color2, color3, (currentIntensity - 0.2) / 0.2);
        } else if (currentIntensity < 0.6) {
          finalColor.lerpColors(color3, color4, (currentIntensity - 0.4) / 0.2);
        } else if (currentIntensity < 0.8) {
          finalColor.lerpColors(color4, color5, (currentIntensity - 0.6) / 0.2);
        } else {
          // Transition to Brownish Red for values > 0.8
          // Clamped at 1.5 to match your shader's likely max visual range
          const factor = Math.min((currentIntensity - 0.8) / 0.7, 1.0);
          finalColor.lerpColors(color5, color6, factor);
        }

        const pressureMPa = currentIntensity * 0.06791698464;
        const heatFactor = Math.min(currentIntensity, 1.0);
        const hue = 0.3 * (1 - heatFactor);
        //console.log(`Inspector Intensity: ${currentIntensity.toFixed(4)}`);
        if (frameCount % 5 === 0) {
          setCurrentIntensity(currentIntensity);

          // 2. Add to our graph data array
          graphDataRef.current.push({
            time: Date.now(),
            value: pressureMPa,
          });

          // Keep only the last 100 points so the graph doesn't lag
          if (graphDataRef.current.length > 100) {
            graphDataRef.current.shift();
          }
        }

        inspectorSphere.material.color.copy(finalColor);
        inspectorSphere.material.emissive.copy(finalColor);

        // Dynamic glow based on total intensity
        inspectorSphere.material.emissiveIntensity = Math.min(
          currentIntensity * 2,
          4.0,
        );
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
        <div>
          Pressure(MPa): {(currentIntensity * 0.06791698464).toFixed(4)}
        </div>
        {/* Pass the Ref here! */}
        <MiniGraph dataRef={graphDataRef} />
      </div>
    </div>
  );
}

export default App;
