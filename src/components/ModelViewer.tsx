import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Stage } from '@react-three/drei';
import ModelErrorBoundary from './ModelErrorBoundary';

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export default function ModelViewer({ url, fallbackMessage }: { url: string; fallbackMessage?: string }) {
  return (
    <ModelErrorBoundary fallbackMessage={fallbackMessage}>
      <div style={{ width: '100%', height: 480, background: '#ffffff', borderRadius: 8 }}>
        <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
          <Suspense fallback={null}>
            <Stage environment="city" intensity={1}>
              <Model url={url} />
            </Stage>
          </Suspense>
          <ambientLight intensity={0.4} />
          <OrbitControls autoRotate autoRotateSpeed={1.5} enablePan={false} />
        </Canvas>
      </div>
    </ModelErrorBoundary>
  );
}
