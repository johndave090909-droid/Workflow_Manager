import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('fish-viewer');
const canvas = document.getElementById('fish-canvas');
const loadingEl = document.getElementById('fish-loading');

if (container && canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1622');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const camera = new THREE.PerspectiveCamera(
    35,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 0.25, 2.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.4;
  controls.maxDistance = 4.6;
  controls.target.set(0, 0.15, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x1b2430, 0.85);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2.4, 2.2, 2.6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffe4bf, 0.65);
  fill.position.set(-2.6, 0.6, 1.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x8ad4ff, 0.55);
  rim.position.set(-2.0, 1.4, -2.2);
  scene.add(rim);

  const loader = new GLTFLoader();
  const modelUrl = '/animations/samples/02/fish.glb';
  let model = null;

  loader.load(
    modelUrl,
    (gltf) => {
      model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? 1.6 / maxDim : 1;
      model.scale.setScalar(scale);

      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center.multiplyScalar(scale));

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = false;
          obj.receiveShadow = false;
          if (obj.material && 'envMapIntensity' in obj.material) {
            obj.material.envMapIntensity = 1.0;
          }
        }
      });

      scene.add(model);
      if (loadingEl) loadingEl.remove();
    },
    (evt) => {
      if (!loadingEl) return;
      if (evt.total) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        loadingEl.textContent = `Loading 3D model... ${pct}%`;
      }
    },
    () => {
      if (loadingEl) {
        loadingEl.textContent = 'Unable to load 3D model.';
      }
    }
  );

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  window.addEventListener('resize', () => {
    resize();
  });

  let isInView = true;
  let isPageVisible = !document.hidden;
  let rafId = null;

  function loop() {
    if (!isInView || !isPageVisible) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      isInView = !!(entry && entry.isIntersecting);
      if (isInView && isPageVisible && !rafId) loop();
    },
    { threshold: 0.2 }
  );
  observer.observe(container);

  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isInView && isPageVisible && !rafId) loop();
  });

  resize();
  loop();
}
