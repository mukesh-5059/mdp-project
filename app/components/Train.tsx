import * as THREE from "three";
import * as CANNON from "cannon-es";

// Add a 'spawnPos' argument to place carts at different locations
export const createTrainCompartment = (
  scene: THREE.Scene,
  world: CANNON.World,
  spawnPos: CANNON.Vec3,
  //visualParts: { chassis: THREE.Object3D; wheels: THREE.Object3D[] },
) => {
  const trainLength = 16;

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
  const wheelXPositions = [7, 4, -4, -7];
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
  const boxMesh = new THREE.Mesh(
    new THREE.BoxGeometry(trainLength, 1, 4),
    new THREE.MeshNormalMaterial(),
  );
  scene.add(boxMesh);

  const wheelMeshes = wheelBodies.map(() => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshNormalMaterial(),
    );
    scene.add(mesh);
    return mesh;
  });

  return {
    vehicle,
    chassisBody, // Export the body so we can link it later
    update: () => {
      boxMesh.position.copy(chassisBody.position as any);
      boxMesh.quaternion.copy(chassisBody.quaternion as any);
      wheelBodies.forEach((body, i) => {
        wheelMeshes[i].position.copy(body.position as any);
        wheelMeshes[i].quaternion.copy(body.quaternion as any);
      });
    },
  };
};
