import { useEditorStore } from '../../store/editorStore'
import { CameraMarker } from './CameraMarker'
import { CameraRig } from './CameraRig'
import { DeviceModel } from './DeviceModel'
import { MediaObject } from './MediaObject'
import { RotationGizmo } from './RotationGizmo'
import { StudioEnvironment } from './StudioEnvironment'
import { TextObject } from './TextObject'

/** Everything inside the WebGL canvas, driven by the editor store. */
export function SceneRoot() {
  const objects = useEditorStore((state) => state.objects)
  const selected = useEditorStore(
    (state) => state.objects.find((object) => object.id === state.selectedObjectId) ?? null,
  )

  return (
    <>
      <StudioEnvironment />
      {objects.map((object) => {
        if (object.kind === 'model') return <DeviceModel key={object.id} object={object} />
        if (object.kind === 'text') return <TextObject key={object.id} object={object} />
        if (object.kind === 'media') return <MediaObject key={object.id} object={object} />
        return null
      })}
      <CameraRig />
      <CameraMarker />
      {selected ? <RotationGizmo key={selected.id} object={selected} /> : null}
    </>
  )
}
