import * as THREE from "three";
import * as CANNON from "cannon-es";

// Add a 'spawnPos' argument to place carts at different locations
export const createTrainCompartment = (
  scene: THREE.Scene,
  world: CANNON.World,
  spawnPos: CANNON.Vec3,
  chassisModel: THREE.Group,
  wheelModel: THREE.Group,
) => {
  const trainLength = 26;

  // 1. Chassis Physics
  const chassisBody = new CANNON.Body({
    mass: 20,
    position: spawnPos, // Use the passed position
    shape: new CANNON.Box(new CANNON.Vec3(trainLength / 2, 0.5, 2)),
  });

  const vehicle = new CANNON.RigidVehicle({ chassisBody });

  // 2. Wheels Physics
  const wheelShape = new CANNON.Sphere(1);
  const wheelMaterial = new CANNON.Material("wheel");
  const wheelXPositions = [12, 7, -7, -12];
  const axisWidth = 5;
  const wheelBodies: CANNON.Body[] = [];

  wheelXPositions.forEach((xPos) => {
    [1, -1].forEach((side) => {
      const wheelBody = new CANNON.Body({ mass: 1, material: wheelMaterial });
      wheelBody.addShape(wheelShape);
      wheelBody.angularDamping = 0.4;
      vehicle.addWheel({
        body: wheelBody,
        position: new CANNON.Vec3(xPos, 0, (axisWidth / 2) * side),
        axis: new CANNON.Vec3(0, 0, 1),
        direction: new CANNON.Vec3(0, -1, 0),
      });
      wheelBodies.push(wheelBody);
    });
  });

  vehicle.addToWorld(world);

  // 3. Visuals
  const chassisClone = chassisModel.clone();
  //chassisClone.rotation.y = Math.PI / 2;
  const whiteMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    metalness: 0.1,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });

  chassisClone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = whiteMaterial;
    }
  });

  scene.add(chassisClone);

  const wheelMeshes = wheelBodies.map(() => {
    const wheelClone = wheelModel.clone();
    //wheelClone.rotation.x = Math.PI / 2;
    wheelClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material = whiteMaterial;
      }
    });
    scene.add(wheelClone);
    return wheelClone;
  });

  return {
    vehicle,
    chassisBody, // Export the body so we can link it later
    update: () => {
      chassisClone.position
        .copy(chassisBody.position as any)
        .add(new THREE.Vector3(0, 1, 0));
      chassisClone.quaternion.copy(chassisBody.quaternion as any);
      wheelBodies.forEach((body, i) => {
        wheelMeshes[i].position.copy(body.position as any);
        wheelMeshes[i].quaternion.copy(body.quaternion as any);
      });
    },
  };
};
