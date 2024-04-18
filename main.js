import * as THREE from "three";
import {
  tslFn,
  uniform,
  storage,
  attribute,
  float,
  vec2,
  vec3,
  color,
  instanceIndex,
  PointsNodeMaterial,
} from "three/nodes";

import { GUI } from "three/addons/libs/lil-gui.module.min.js";

import WebGPU from "three/addons/capabilities/WebGPU.js";
import WebGL from "three/addons/capabilities/WebGL.js";

import WebGPURenderer from "three/addons/renderers/webgpu/WebGPURenderer.js";
import StorageInstancedBufferAttribute from "three/addons/renderers/common/StorageInstancedBufferAttribute.js";

let camera, scene, renderer;
let computeNode;

const pointerVector = new THREE.Vector2(-10.0, -10.0); // Out of bounds first
const scaleVector = new THREE.Vector2(1, 1);

init();

function init() {
  if (WebGPU.isAvailable() === false && WebGL.isWebGL2Available() === false) {
    document.body.appendChild(WebGPU.getErrorMessage());

    throw new Error("No WebGPU or WebGL2 support");
  }

  camera = new THREE.OrthographicCamera(-1.0, 1.0, 1.0, -1.0, 0, 1);
  camera.position.z = 1;

  scene = new THREE.Scene();

  // initialize particles

  const particleCount = 300000;

  // create buffers

  const particleBuffer = new StorageInstancedBufferAttribute(
    particleCount,
    2, // vec2
  );
  const velocityBuffer = new StorageInstancedBufferAttribute(
    particleCount,
    2, // vec2
  );
  const colorBuffer = new StorageInstancedBufferAttribute(
    particleCount,
    3, // vec3
  );

  const particleBufferNode = storage(particleBuffer, "vec2", particleCount);
  const velocityBufferNode = storage(velocityBuffer, "vec2", particleCount);
  const colorBufferNode = storage(colorBuffer, "vec3", particleCount);

  // create function

  const computeShaderFn = tslFn(() => {
    const particle = particleBufferNode.element(instanceIndex);
    const velocity = velocityBufferNode.element(instanceIndex);
    const color = colorBufferNode.element(instanceIndex);

    const pointer = uniform(pointerVector);
    const limit = uniform(scaleVector);

    const position = particle.add(velocity).temp();

    velocity.x = position.x
      .abs()
      .greaterThanEqual(limit.x)
      .cond(velocity.x.negate(), velocity.x);
    velocity.y = position.y
      .abs()
      .greaterThanEqual(limit.y)
      .cond(velocity.y.negate(), velocity.y);

    position.assign(position.min(limit).max(limit.negate()));

    const polarPosition = vec2(
      position.length(),
      position.y
        .atan2(position.x)
        .div(2 * Math.PI)
        .add(0.5),
    );

    const a = vec3(0.261, 0.446, 0.315),
      b = vec3(0.843, 0.356, 0.239),
      c = vec3(0.948, 1.474, 1.361),
      d = vec3(3.042, 5.63, 5.424);
    // vec3 palette(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    //   return a + b * cos(6.28318 * (c * t + d));
    // }
    color.assign(
      a.add(b.mul(polarPosition.x.mul(c).add(d).mul(6.28318).cos())),
    );

    const pointerSize = 0.1;
    const distanceFromPointer = pointer.sub(position).length();

    particle.assign(
      distanceFromPointer.lessThanEqual(pointerSize).cond(vec3(), position),
    );
  });

  // compute

  computeNode = computeShaderFn().compute(particleCount);
  computeNode.onInit = ({ renderer }) => {
    const precomputeShaderNode = tslFn(() => {
      const particleIndex = float(instanceIndex);

      const randomAngle = particleIndex.mul(0.005).mul(Math.PI * 2);
      const randomSpeed = particleIndex.mul(0.00000004).add(0.0000001);

      const velX = randomAngle.sin().mul(randomSpeed);
      const velY = randomAngle.cos().mul(randomSpeed);

      const velocity = velocityBufferNode.element(instanceIndex);

      velocity.xy = vec2(velX, velY);
    });

    renderer.compute(precomputeShaderNode().compute(particleCount));
  };

  // use a compute shader to animate the point cloud's vertex data.

  const particleNode = attribute("particle", "vec2");
  const colorNode = attribute("color", "vec3");

  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(3), 3),
  ); // single vertex ( not triangle )
  pointsGeometry.setAttribute("particle", particleBuffer); // dummy the position points as instances
  pointsGeometry.setAttribute("color", colorBuffer);
  pointsGeometry.drawRange.count = 1; // force render points as instances ( not triangle )

  const pointsMaterial = new PointsNodeMaterial();
  pointsMaterial.colorNode = colorNode.add(color(0x000000));
  pointsMaterial.positionNode = particleNode;

  const mesh = new THREE.Points(pointsGeometry, pointsMaterial);
  mesh.isInstancedMesh = true;
  mesh.count = particleCount;
  scene.add(mesh);

  renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(animate);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("mousemove", onMouseMove);

  // gui

  const gui = new GUI();

  gui.add(scaleVector, "x", 0, 1, 0.01);
  gui.add(scaleVector, "y", 0, 1, 0.01);
}

function onWindowResize() {
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
  const x = event.clientX;
  const y = event.clientY;

  const width = window.innerWidth;
  const height = window.innerHeight;

  pointerVector.set((x / width - 0.5) * 2.0, (-y / height + 0.5) * 2.0);
}

function animate() {
  renderer.compute(computeNode);
  renderer.render(scene, camera);
}
