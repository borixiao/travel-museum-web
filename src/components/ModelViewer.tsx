import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Stage } from '@react-three/drei';

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export default function ModelViewer({ url }: { url: string }) {
  return (
    <div style={{ width: '100%', height: 480, background: '#ffffff', borderRadius: 8 }}>
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
        <Suspense fallback={null}>
          <Stage environment={null} intensity={0.6}>
            <Model url={url} />
          </Stage>
        </Suspense>
        <OrbitControls autoRotate autoRotateSpeed={1.5} enablePan={false} />
      </Canvas>
    </div>
  );
}
