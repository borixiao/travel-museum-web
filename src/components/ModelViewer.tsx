import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Stage } from '@react-three/drei';
import ModelErrorBoundary from './ModelErrorBoundary';

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  // useGLTF caches the parsed GLTF by url, so every <ModelViewer> mounted for
  // the same modelUrl (e.g. a Moodboard card's own inline 3D preview AND the
  // "tap to expand" detail modal opened on top of it — see
  // MoodboardCardDetailModal.tsx) gets back the exact same `scene` Object3D
  // instance. An Object3D can only have one parent at a time, so mounting the
  // shared scene into the modal's <Canvas> silently reparents it away from
  // the card's own <Canvas>; closing the modal then unmounts that canvas
  // without ever putting the scene back, leaving the card blank/white.
  // Cloning per-instance gives each embed its own independent node graph —
  // geometries/materials are still shared by reference under .clone(), so
  // this doesn't duplicate GPU memory, just the parentable Object3D nodes.
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  return <primitive object={clonedScene} />;
}

export default function ModelViewer({
  url,
  fallbackMessage,
  interactive = true,
  height = 480,
}: {
  url: string;
  fallbackMessage?: string;
  // Moodboard cards embed this as a passive preview (Sticker/3D toggle) while
  // still sitting inside the card's own move/rotate/resize pointer-capture
  // drag system — OrbitControls' pointer-drag camera control would otherwise
  // fight over the same pointer. Setting `pointerEvents: 'none'` on this
  // component's own wrapper (rather than trying to disable OrbitControls'
  // internal listeners piecemeal) makes the browser's hit-testing skip this
  // element entirely and fall through to whatever's beneath it in the DOM —
  // in the moodboard card's case, that's the card's own draggable wrapper —
  // so a "drag" started on top of a non-interactive model preview just moves
  // the card, exactly like it would starting on top of a plain thumbnail img.
  interactive?: boolean;
  height?: number | string;
}) {
  return (
    <ModelErrorBoundary fallbackMessage={fallbackMessage}>
      <div style={{ width: '100%', height, background: '#ffffff', borderRadius: 8, pointerEvents: interactive ? 'auto' : 'none' }}>
        <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
          <Suspense fallback={null}>
            <Stage environment="city" intensity={1}>
              <Model url={url} />
            </Stage>
          </Suspense>
          <ambientLight intensity={0.4} />
          <OrbitControls
            autoRotate
            autoRotateSpeed={1.5}
            enablePan={false}
            enableRotate={interactive}
            enableZoom={interactive}
          />
        </Canvas>
      </div>
    </ModelErrorBoundary>
  );
}
