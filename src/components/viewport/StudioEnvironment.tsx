import { ContactShadows, Environment, Grid, Lightformer } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { resolveSceneFrame, resolveSceneState } from '../../lib/keyframes'
import { useEditorStore } from '../../store/editorStore'

/**
 * Push scene-wide render settings (exposure, environment strength) to three.js.
 *
 * Driven from the frame loop rather than from React: the light now *blends*
 * between keyframes, so its value changes every frame of a move — re-rendering
 * the tree at that rate is exactly what this editor is built to avoid.
 */
function SceneTuning() {
  const scene = useThree((state) => state.scene)
  const renderer = useThree((state) => state.gl)
  const lightRef = useRef<THREE.AmbientLight>(null)

  useFrame(() => {
    const state = useEditorStore.getState()
    const resolved = resolveSceneState(state.objects, state.timeline.currentTime, state.scene)
    scene.environmentIntensity = resolved.envIntensity
    renderer.toneMappingExposure = resolved.exposure
    if (lightRef.current) lightRef.current.intensity = 0.22 * resolved.envIntensity
  })

  return <ambientLight ref={lightRef} intensity={0.22} />
}

/**
 * A studio built from light cards instead of an HDRI file: no network fetch,
 * deterministic highlights, and one intensity knob for the whole rig.
 */
function StudioLights() {
  const envIntensity = useEditorStore((state) => state.scene.envIntensity)

  return (
    <>

      <directionalLight
        castShadow
        position={[3.6, 6.2, 4.2]}
        intensity={1.9 * envIntensity}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={24}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-4.5, 2.4, -3.4]} intensity={0.45 * envIntensity} color="#93b4ff" />
      <directionalLight position={[0, 1.2, -5]} intensity={0.3 * envIntensity} color="#ffd9bd" />

      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={3.2}
          color="#ffffff"
          position={[0, 5.5, 0.5]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[9, 9, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.1}
          color="#cfdcff"
          position={[-5.5, 2.2, 2.5]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[7, 4.5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.5}
          color="#ffe0c2"
          position={[5.5, 1.6, -2.5]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[7, 4, 1]}
        />
        <Lightformer form="ring" intensity={1.4} color="#ffffff" position={[0, -3.5, 0]} scale={5} />
      </Environment>
    </>
  )
}

/**
 * Contact shadow and the optional grid.
 *
 * No floor mesh: the device hangs on its shadow, so an exported frame can be
 * transparent without cutting a plinth out of it.
 */
function Stage() {
  const shadow = useEditorStore(
    (state) => resolveSceneFrame(state.objects, state.timeline.currentTime, state.scene).shadow,
  )
  const showGrid = useEditorStore((state) => state.ui.showGrid)

  return (
    <>
      {shadow.enabled ? (
        <ContactShadows
          position={[0, 0.002, 0]}
          opacity={shadow.opacity}
          scale={7}
          blur={shadow.blur}
          far={2.4}
          resolution={512}
          color="#000000"
        />
      ) : null}

      {showGrid ? (
        <Grid
          name="editor:grid"
          position={[0, 0.004, 0]}
          args={[16, 16]}
          cellSize={0.25}
          cellThickness={0.55}
          cellColor="#2b3446"
          sectionSize={1}
          sectionThickness={0.9}
          sectionColor="#3f4d68"
          fadeDistance={20}
          fadeStrength={1.6}
          infiniteGrid
        />
      ) : null}
    </>
  )
}

export function StudioEnvironment() {
  return (
    <>
      <SceneTuning />
      <StudioLights />
      <Stage />
    </>
  )
}
