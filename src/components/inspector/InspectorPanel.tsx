import { evaluateFrame } from '../../lib/animation'
import { useT } from '../../lib/i18n'
import { useEditorStore } from '../../store/editorStore'
import type { CameraKeyframe, InspectorTab, ObjectKeyframe } from '../../types'
import { resampleSpeedCurve } from '../../lib/speedCurve'
import { ScreenPicker } from '../screen/ScreenPicker'
import { SpeedCurveEditor } from './SpeedCurveEditor'
import {
  ColorField,
  Hint,
  Section,
  SelectField,
  SliderField,
  TextField,
  ToggleField,
} from '../ui/controls'
import { Segmented, Tab, TabList, TabPanel, Tabs } from '../ui/kit'

/* ------------------------------------------------------------------ object */

/**
 * 对象 inside a keyframe: what the thing is called, and — for a 3D model, which is
 * the only kind that has a display — which picture or clip sits on its screen at
 * this frame.
 */
function ObjectTab() {
  const t = useT()
  // Hooks first, always: an early return before a hook changes how many are
  // called when the selection clears, which takes the whole React root down
  // (and with it the canvas, i.e. a black camera preview).
  const object = useEditorStore((state) =>
    state.objects.find((entry) => entry.id === state.selectedObjectId),
  )
  const currentTime = useEditorStore((state) => state.timeline.currentTime)
  /**
   * 隐藏属于帧，所以这里读的是**求值后**的那一帧，而不是对象上的静态字段：
   * 拖动播放头时开关会跟着变，一眼就能看出这一帧到底在不在。
   */
  const hidden = useEditorStore(
    (state) =>
      evaluateFrame(state, state.timeline.currentTime).objects[state.selectedObjectId ?? '']?.hidden ??
      false,
  )
  /** 这一帧的显隐切换方式 —— 和存储一样属于帧（缺省是瞬间）。 */
  const hideMode = useEditorStore(
    (state) =>
      evaluateFrame(state, state.timeline.currentTime).objects[state.selectedObjectId ?? '']?.hideMode ??
      'cut',
  )

  if (!object) return <div className="timeline__empty">{t('未选中对象。')}</div>

  return (
    <>
      <Section title={t('对象')} right={<span className="field__hint">{currentTime.toFixed(2)}s</span>}>
        <TextField
          label={t('名称')}
          value={object.name}
          onChange={(name) => useEditorStore.getState().renameObject(object.id, name)}
        />
        <ToggleField
          label={t('隐藏')}
          checked={hidden}
          onChange={(value) => useEditorStore.getState().setObjectHidden(object.id, value)}
        />
        <SelectField
          label={t('切换方式')}
          value={hideMode}
          options={[
            { value: 'cut', label: t('瞬间消失 / 显示') },
            { value: 'fade', label: t('渐隐 / 渐显') },
          ]}
          onChange={(mode) => useEditorStore.getState().setObjectHideMode(object.id, mode)}
        />
      </Section>

      {object.kind === 'text' || object.kind === 'media' ? (
        <Section title={t('出场动画')}>
          <SelectField
            label={t('动效')}
            value={object.entrance.type}
            options={[
              { value: 'none', label: t('无') },
              { value: 'fade', label: t('淡入') },
              { value: 'slide-up', label: t('上滑') },
              { value: 'slide-down', label: t('下滑') },
              { value: 'slide-left', label: t('左滑') },
              { value: 'slide-right', label: t('右滑') },
              { value: 'reveal', label: t('边缘展开') },
              { value: 'scale', label: t('缩放') },
              { value: 'rotate', label: t('旋转') },
              { value: 'sling', label: t('甩入') },
              { value: 'bounce', label: t('弹跳') },
            ]}
            onChange={(type) => useEditorStore.getState().setObjectEntrance(object.id, { type })}
          />
          <SliderField
            label={t('时长')}
            value={object.entrance.duration}
            min={0.1}
            max={3}
            step={0.1}
            onChange={(duration) => useEditorStore.getState().setObjectEntrance(object.id, { duration })}
          />
          <SliderField
            label={t('延迟')}
            value={object.entrance.delay}
            min={0}
            max={3}
            step={0.05}
            onChange={(delay) => useEditorStore.getState().setObjectEntrance(object.id, { delay })}
          />
        </Section>
      ) : null}

      {object.kind === 'model' ? (
        <Section
          title={t('屏幕贴图')}
          right={<span className="field__hint">{currentTime.toFixed(2)}s</span>}
        >
          <ScreenPicker object={object} />
        </Section>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------- scene */

function SceneTab() {
  const t = useT()
  const scene = useEditorStore((state) => state.scene)
  const updateScene = useEditorStore((state) => state.updateScene)

  return (
    <>
      <Section title={t('背景')}>
        <Segmented
          wide
          value={scene.background.type === 'gradient' ? 'gradient' : 'solid'}
          options={[
            { value: 'solid', label: t('纯色') },
            { value: 'gradient', label: t('渐变') },
          ]}
          onChange={(type) => updateScene({ background: { ...scene.background, type } })}
        />

        {scene.background.type === 'gradient' ? (
          <>
            <ColorField
              label={t('起点')}
              value={scene.background.from}
              onChange={(from) => updateScene({ background: { ...scene.background, from } })}
            />
            <ColorField
              label={t('终点')}
              value={scene.background.to}
              onChange={(to) => updateScene({ background: { ...scene.background, to } })}
            />
            <SliderField
              label={t('角度')}
              min={0}
              max={360}
              step={1}
              value={scene.background.angle}
              format={(value) => `${Math.round(value)}°`}
              onChange={(angle) => updateScene({ background: { ...scene.background, angle } })}
            />
          </>
        ) : (
          <ColorField
            label={t('颜色')}
            value={scene.background.color}
            // Picking a colour also makes the background a solid, so the change
            // can never be one you cannot see.
            onChange={(color) =>
              updateScene({ background: { ...scene.background, type: 'solid', color } })
            }
          />
        )}
      </Section>

      <Section title={t('照明')}>
        <SliderField
          label={t('环境强度')}
          min={0}
          max={2.5}
          value={scene.envIntensity}
          onChange={(envIntensity) => updateScene({ envIntensity })}
        />
        <SliderField
          label={t('曝光')}
          min={0.2}
          max={2.5}
          value={scene.exposure}
          onChange={(exposure) => updateScene({ exposure })}
        />
      </Section>
    </>
  )
}

/* -------------------------------------------------------------------- clip */

/**
 * 变速 — the Bézier speed ramp of one keyframe segment.
 *
 * The ramp lives on the keyframe the segment *arrives* at, which is exactly the
 * idea the editor is built on: everything between two keyframes is one piece of
 * content, and this is how that content is re-timed. With no keyframe selected
 * the tab follows the playhead.
 */
function SpeedTab() {
  const object = useEditorStore((state) =>
    state.objects.find((entry) => entry.id === state.selectedObjectId) ?? null,
  )
  const selectedClipId = useEditorStore((state) => state.timeline.selectedClipId)
  const clipOwner = useEditorStore((state) =>
    state.objects.find((entry) =>
      entry.screenClips.some((clip) => clip.id === state.timeline.selectedClipId),
    ),
  )
  const clip = clipOwner?.screenClips.find((entry) => entry.id === selectedClipId) ?? null
  const cameraKeyframes = useEditorStore((state) => state.timeline.cameraKeyframes)
  const selectedKeyframeId = useEditorStore((state) => state.timeline.selectedKeyframeId)
  const currentTime = useEditorStore((state) => state.timeline.currentTime)

  type Target =
    | { kind: 'object'; objectId: string; frames: ObjectKeyframe[]; index: number }
    | { kind: 'camera'; frames: CameraKeyframe[]; index: number }

  const target: Target | null = (() => {
    const objectFrames = object?.keyframes ?? []
    const objectIndex = objectFrames.findIndex((frame) => frame.id === selectedKeyframeId)
    if (object && objectIndex >= 0) {
      return { kind: 'object', objectId: object.id, frames: objectFrames, index: objectIndex }
    }
    const cameraIndex = cameraKeyframes.findIndex((frame) => frame.id === selectedKeyframeId)
    if (cameraIndex >= 0) return { kind: 'camera', frames: cameraKeyframes, index: cameraIndex }
    if (object && objectFrames.length > 0) {
      const upcoming = objectFrames.findIndex((frame) => frame.time >= currentTime - 1e-3)
      return {
        kind: 'object',
        objectId: object.id,
        frames: objectFrames,
        index: upcoming < 0 ? objectFrames.length - 1 : upcoming,
      }
    }
    return null
  })()

  // A selected video clip takes precedence: 变速 then means the clip's rate.
  if (clip && clipOwner) {
    return (
      <Section
        title="视频片段变速"
        right={<span className="field__hint">{clip.name}</span>}
      >
        <SpeedCurveEditor
          curve={clip.speed}
          playhead={null}
          onChange={(speed) =>
            useEditorStore.getState().setScreenClipSpeed(clipOwner.id, clip.id, speed)
          }
          onCountChange={(count) =>
            useEditorStore
              .getState()
              .setScreenClipSpeed(
                clipOwner.id,
                clip.id,
                resampleSpeedCurve(clip.speed, count),
              )
          }
        />
      </Section>
    )
  }

  if (!target) {
    return (
      <div className="timeline__empty">
        选中一个对象，把播放头挪到想要的位置，按 <b>D</b> 打一个关键帧。
        <br />
        两个关键帧之间的那一段，就是这里要调的内容。
      </div>
    )
  }

  const frame = target.frames[target.index]
  const previous = target.frames[target.index - 1] ?? null
  const store = useEditorStore.getState

  if (!previous) {
    return <div className="timeline__empty">对于首帧，此设置无效。</div>
  }

  return (
    <>
      <Section title="这一段的播放速度">
        <Hint>
          {target.kind === 'camera' ? '摄像机' : (object?.name ?? '对象')} ·{' '}
          {previous ? `${previous.time.toFixed(2)}s → ` : '起点 → '}
          {frame.time.toFixed(2)}s
        </Hint>
        <SpeedCurveEditor
          curve={frame.speed}
          playhead={
            previous && frame.time > previous.time
              ? (currentTime - previous.time) / (frame.time - previous.time)
              : null
          }
          onChange={(speed) => {
            if (target.kind === 'object') store().setObjectKeyframeSpeed(target.objectId, frame.id, speed)
            else store().setCameraKeyframeSpeed(frame.id, speed)
          }}
          onCountChange={(count) =>
            target.kind === 'object'
              ? store().setObjectKeyframeNodeCount(target.objectId, frame.id, count)
              : store().setCameraKeyframeNodeCount(frame.id, count)
          }
        />
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------- panel */

/**
 * The panel is always looking at *a frame*: 对象 (its texture), 变速 (how the
 * segment arrives at it) and 场景 (the room it stands in). There is no
 * "no frame" state — with nothing picked it falls back to the first frame.
 */
const KEYFRAME_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'object', label: '对象' },
  { id: 'speed', label: '变速' },
  { id: 'scene', label: '场景' },
]

/**
 * A selected video clip has no texture of its own — the screen's texture belongs
 * to the keyframes — so 变速 is the only thing left to edit on it.
 */
const CLIP_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'speed', label: '变速' },
]

export function InspectorPanel() {
  const t = useT()
  const tab = useEditorStore((state) => state.ui.inspectorTab)
  const setTab = useEditorStore((state) => state.setInspectorTab)
  /**
   * With a keyframe selected the panel narrows to the two things that belong to
   * a frame — the object as it stands there and the ramp of the segment — so the
   * eye is not pulled to 材质/相机/场景 while posing a single frame.
   */
  // `selectedClipId` is checked against the timeline, not just for being set: a
  // stale id must never pin the panel to 变速.
  const clipSelected = useEditorStore((state) =>
    Boolean(
      state.timeline.selectedClipId &&
        state.objects.some((object) =>
          object.screenClips.some((clip) => clip.id === state.timeline.selectedClipId),
        ),
    ),
  )
  // A video clip has no texture of its own, so it offers 变速 alone.
  const tabs = clipSelected ? CLIP_TABS : KEYFRAME_TABS
  // Whatever is on screen, 相机 is gone and the panel never leaves a frame.
  const active = tabs.some((entry) => entry.id === tab) ? tab : tabs[0].id

  return (
    <div className="panel">
      <Tabs value={active} onValueChange={(next) => setTab(next as InspectorTab)}>
        <TabList>
          {tabs.map((entry) => (
            <Tab key={entry.id} value={entry.id}>
              {t(entry.label)}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="object">{active === 'object' ? <ObjectTab /> : null}</TabPanel>
        <TabPanel value="scene">{active === 'scene' ? <SceneTab /> : null}</TabPanel>
        <TabPanel value="speed">{active === 'speed' ? <SpeedTab /> : null}</TabPanel>
      </Tabs>
    </div>
  )
}
