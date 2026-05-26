import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

import earthCloudsUrl from '../assets/earth/earth_clouds.png';
import earthDayUrl from '../assets/earth/earth_day.jpg';
import earthLightsUrl from '../assets/earth/earth_lights.png';
import earthNormalUrl from '../assets/earth/earth_normal.jpg';
import earthSpecularUrl from '../assets/earth/earth_specular.jpg';

function useEarthTextures() {
  const [day, normal, specular, clouds, lights] = useLoader(THREE.TextureLoader, [
    earthDayUrl,
    earthNormalUrl,
    earthSpecularUrl,
    earthCloudsUrl,
    earthLightsUrl,
  ]);

  useMemo(() => {
    [day, normal, specular, clouds, lights].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    });
    normal.colorSpace = THREE.NoColorSpace;
    specular.colorSpace = THREE.NoColorSpace;
  }, [clouds, day, lights, normal, specular]);

  return { day, normal, specular, clouds, lights };
}

function EarthModel() {
  const earthRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const lightsRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const textures = useEarthTextures();

  const atmosphereMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color('#62d9ff') },
      coefficient: { value: 0.1 },
      power: { value: 2.8 },
      intensity: { value: 0.24 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float coefficient;
      uniform float power;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float alpha = pow(rim + coefficient, power) * intensity;
        gl_FragColor = vec4(glowColor, clamp(alpha, 0.0, 0.18));
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime;

    if (earthRef.current) {
      earthRef.current.rotation.y = THREE.MathUtils.degToRad(-128) + elapsed * 0.045;
      earthRef.current.rotation.x = THREE.MathUtils.degToRad(-23.4);
      earthRef.current.rotation.z = THREE.MathUtils.degToRad(5);
    }

    if (cloudsRef.current) {
      cloudsRef.current.rotation.y = elapsed * 0.075;
    }

    if (lightsRef.current) {
      lightsRef.current.rotation.y = elapsed * 0.055;
    }

    if (haloRef.current) {
      const pulse = 1 + Math.sin(elapsed * 0.9) * 0.006;
      haloRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group rotation={[0.15, -0.55, -0.08]}>
      <group ref={earthRef}>
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[1, 192, 192]} />
          <meshPhongMaterial
            map={textures.day}
            normalMap={textures.normal}
            normalScale={new THREE.Vector2(0.62, 0.62)}
            specularMap={textures.specular}
            specular={new THREE.Color('#31475c')}
            shininess={11}
          />
        </mesh>

        <mesh ref={lightsRef}>
          <sphereGeometry args={[1.004, 192, 192]} />
          <meshBasicMaterial
            map={textures.lights}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <mesh ref={cloudsRef}>
          <sphereGeometry args={[1.014, 192, 192]} />
          <meshPhongMaterial
            map={textures.clouds}
            transparent
            opacity={0.44}
            depthWrite={false}
            shininess={4}
          />
        </mesh>

        <mesh ref={haloRef}>
          <sphereGeometry args={[1.025, 128, 128]} />
          <primitive object={atmosphereMaterial} attach="material" />
        </mesh>
      </group>
    </group>
  );
}

function LoadingGlobe() {
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial color="#28465f" roughness={0.8} />
    </mesh>
  );
}

export default function EarthGlobe() {
  return (
    <div className="earth-globe" aria-label="真实质感地球 3D 模型">
      <Canvas
        camera={{ position: [0, 0.08, 3.25], fov: 38, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        shadows
        style={{ position: 'absolute', inset: 0, background: 'transparent' }}
      >
        <color attach="background" args={['#02070e']} />
        <fog attach="fog" args={['#02070e', 5.8, 13]} />
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#dff8ff', '#08101d', 0.56]} />
        <directionalLight position={[4.4, 1.9, 3.8]} intensity={2.7} color="#fff4dc" castShadow />
        <pointLight position={[-3.2, -1.5, -2.6]} intensity={2.45} color="#2aa8ff" distance={6} />
        <Stars radius={56} depth={28} count={1600} factor={2.8} saturation={0} fade speed={0.28} />
        <Suspense fallback={<LoadingGlobe />}>
          <EarthModel />
        </Suspense>
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          autoRotate
          autoRotateSpeed={0.18}
          minDistance={2.15}
          maxDistance={4.8}
          enablePan={false}
        />
      </Canvas>
    </div>
  );
}
