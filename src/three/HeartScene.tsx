import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ecgEngine } from '../engine/ecgEngine';
import { HeartSilhouette } from './HeartSilhouette';

export type HeartState = 'disconnected' | 'waiting' | 'good' | 'warning' | 'review';

/**
 * The muscle keeps its anatomical material at all times — no state recolours the
 * tissue, because a red heart and a pale heart would read as a health verdict.
 * State is carried by a rim light and a faint emissive that tracks monitoring
 * status only (off / searching / live / attention / review).
 */
const STATE_GLOW: Record<HeartState, string> = {
  disconnected: '#3a3a3a',
  waiting: '#9fb0c2',
  good: '#ffffff',
  warning: '#d4a017',
  review: '#bf5b52',
};

const STATE_EMISSIVE: Record<HeartState, number> = {
  disconnected: 0.0,
  waiting: 0.05,
  good: 0.07,
  warning: 0.1,
  review: 0.12,
};

/** Anatomical surface supplied with the project; textures are embedded in the GLB. */
const MODEL_URL = '/models/heart/heart.glb';

/** World-space height of the model after normalisation (the camera fits ~3.9). */
const HEART_HEIGHT = 3.3;

/**
 * The FBX was authored in centimetres, so it carries a uniform ~286× node scale
 * and sits off-centre. Both are irrelevant to the framing: the geometry is
 * recentred and rescaled to a fixed height, so asset units never reach the camera.
 */
function useHeartModel() {
  const { scene } = useLoader(GLTFLoader, MODEL_URL);

  return useMemo(() => {
    let source: THREE.Mesh | null = null;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!source && mesh.isMesh) source = mesh;
    });
    if (!source) throw new Error('heart model contains no mesh');

    const mesh = source as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.computeBoundingBox();

    const box = geometry.boundingBox as THREE.Box3;
    const size = box.getSize(new THREE.Vector3());
    const scale = HEART_HEIGHT / size.y;

    geometry.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      -(box.min.z + box.max.z) / 2,
    );
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingSphere();

    // Only the colour and normal maps are used. The supplied roughness map is
    // authored for a hero-render look: at panel size it turns the ventricle into
    // a mirror and every pale patch of epicardial fat into a bright plate.
    const { map, normalMap } = mesh.material as THREE.MeshStandardMaterial;
    return { geometry, map, normalMap };
  }, [scene]);
}

function HeartModel({
  state,
  reducedMotion,
  onReady,
}: {
  state: HeartState;
  reducedMotion: boolean;
  onReady?: () => void;
}) {
  const pivot = useRef<THREE.Group>(null);
  const beat = useRef<THREE.Group>(null);
  const rimLight = useRef<THREE.PointLight>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const impulse = useRef(0);
  const { geometry, map, normalMap } = useHeartModel();
  const targetColor = useMemo(() => new THREE.Color(STATE_GLOW[state]), [state]);

  useEffect(() => ecgEngine.subscribeBeats(() => {
    impulse.current = 1;
  }), []);

  // Fires once the GLB and its embedded maps have decoded, which is the moment
  // the scene can actually be painted — the placeholder fades from here.
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);

    // Beat impulse: fast attack, ~300 ms decay. Phase-locked to detected R-peaks.
    impulse.current *= Math.exp(-dt / 0.105);
    const pulse = reducedMotion ? 0 : impulse.current;

    if (beat.current) {
      // Ventricular ejection is a squeeze, not a uniform inflate: y compresses
      // slightly as the chamber scales up, which reads far more like a beat.
      beat.current.scale.set(1 + 0.02 * pulse, 1 - 0.01 * pulse, 1 + 0.024 * pulse);
    }

    if (pivot.current && !reducedMotion) {
      // A small arc around the anterior three-quarter view, so the silhouette
      // stays readable instead of slowly turning to the back of the organ.
      const t = performance.now();
      pivot.current.rotation.y = -0.34 + Math.sin(t / 5200) * 0.13;
      pivot.current.rotation.x = 0.02 + Math.sin(t / 7100) * 0.025;
    }

    if (materialRef.current) {
      materialRef.current.emissive.lerp(targetColor, 0.05);
      materialRef.current.emissiveIntensity = STATE_EMISSIVE[state] * (0.6 + pulse * 1.4);
    }

    if (rimLight.current) {
      rimLight.current.intensity = 1.1 + pulse * 3.2;
      rimLight.current.color.lerp(targetColor, 0.08);
    }
  });

  return (
    <group ref={pivot} rotation={[0.02, -0.34, 0]} position={[0, 0.06, 0]}>
      <group ref={beat}>
        <mesh geometry={geometry}>
          <meshPhysicalMaterial
            ref={materialRef}
            map={map}
            normalMap={normalMap}
            normalScale={new THREE.Vector2(0.65, 0.65)}
            roughness={0.62}
            metalness={0}
            clearcoat={0.2}
            clearcoatRoughness={0.5}
            envMapIntensity={0.4}
            emissive={STATE_GLOW[state]}
            emissiveIntensity={STATE_EMISSIVE[state]}
          />
        </mesh>
      </group>
      <pointLight ref={rimLight} position={[0.6, 0.8, 2.2]} distance={7} intensity={1.1} color={STATE_GLOW[state]} />
    </group>
  );
}

/**
 * Lights, environment and model without the canvas wrapper, so a verification harness can mount the
 * identical scene in an imperative R3F root (see docs/TESTING_AND_VERIFICATION.md §7).
 */
export function HeartSceneContent({
  state,
  reducedMotion,
  onReady,
}: {
  state: HeartState;
  reducedMotion: boolean;
  onReady?: () => void;
}) {
  return (
    <>
      {/* Filmic keys only: the muscle reads as deep crimson, so the light budget stays
          low — piled-on fills turned the tissue into pale pink plastic. */}
      <ambientLight intensity={0.16} />
      <hemisphereLight args={['#e6edf5', '#120709', 0.24]} />
      {/* Key: warm and slightly above, the "studio softbox" that sells wet tissue. */}
      <directionalLight position={[3.2, 4.6, 4.2]} intensity={2.6} color="#fff3ea" />
      {/* Fill: cold and low, keeps the shadow side from going muddy. */}
      <directionalLight position={[-4.4, -0.6, 2.4]} intensity={0.6} color="#9fb6cc" />
      {/* Kicker from behind for the silhouette edge. */}
      <spotLight position={[-1.4, 2.6, -3.4]} angle={0.85} penumbra={1} intensity={2.6} color="#ffffff" />
      {/* Local reflections only — no HDR file is downloaded at runtime. */}
      <Environment resolution={128} frames={1} environmentIntensity={0.35}>
        <Lightformer intensity={2.0} position={[3, 3, 4]} scale={[6, 6, 1]} color="#fff2e8" />
        <Lightformer intensity={0.7} position={[-4, 0, 3]} scale={[6, 6, 1]} color="#9fb6cc" />
        <Lightformer intensity={1.2} position={[0, 4, -4]} scale={[8, 3, 1]} color="#ffffff" />
      </Environment>
      <Suspense fallback={null}>
        <HeartModel state={state} reducedMotion={reducedMotion} onReady={onReady} />
      </Suspense>
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 3.4}
        maxPolarAngle={Math.PI / 1.62}
        rotateSpeed={0.5}
      />
    </>
  );
}

export function HeartScene({
  state,
  reducedMotion,
  className,
}: {
  state: HeartState;
  reducedMotion: boolean;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const handleReady = useCallback(() => setReady(true), []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <Canvas
        dpr={[1, 1.9]}
        camera={{ position: [0, 0.1, 6.5], fov: 34 }}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
        frameloop="always"
      >
        <HeartSceneContent state={state} reducedMotion={reducedMotion} onReady={handleReady} />
      </Canvas>
      <HeartSilhouette visible={!ready} />
    </div>
  );
}
