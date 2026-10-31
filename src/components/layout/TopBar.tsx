import { Download, FileCode2, FileImage, Film, FolderOpen, Save, Settings2, Upload } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useRef, useState } from 'react'
import { LOCALES, useLocale, useLocaleStore, useT } from '../../lib/i18n'
import { downloadDataUrl, requestShotCapture } from '../../lib/capture'
import { seekBackdropVideo } from '../../lib/backdrop'
import {
  loadResourcesByName,
  saveProject,
} from '../../lib/workspace'
import {
  canPickDirectory,
  hasNativePicker,
  mediaFilesFor,
  missingResources,
  nativePickFolder,
  pickFolder,
  projectCandidates,
  readFileText,
  readProjectText,
  relativeOf,
  withRelativePath,
  type FolderEntry,
  type ProjectFile,
} from '../../lib/projectImport'
import { lastKeyframeTime } from '../../lib/keyframes'
import { toProjectText } from '../../lib/projectText'
import { downloadBlob, exportVideo } from '../../lib/videoExport'
import { ASPECT_RATIO, type ProjectAspect } from '../../types'
import { hasUnsavedChanges, markClean, useEditorStore } from '../../store/editorStore'
import { SelectField } from '../ui/controls'
import { Button, Dialog, DialogContent, Segmented, Tip } from '../ui/kit'

const ASPECTS: Array<{ value: ProjectAspect; label: string }> = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '21:9', label: '21:9' },
]

/** Standard frame rates for film and video. */
const FPS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '24', label: '24' },
  { value: '25', label: '25' },
  { value: '30', label: '30' },
  { value: '50', label: '50' },
  { value: '60', label: '60' },
  { value: '120', label: '120' },
]

/**
 * The top bar: who this is, what the project is called, and the three things you
 * do with a project — bring something in, set the frame, send it out.
 */
export function TopBar() {
  const t = useT()
  const locale = useLocale()
  const setLocale = useLocaleStore((state) => state.setLocale)
  const project = useEditorStore((state) => state.project)
  const setProjectName = useEditorStore((state) => state.setProjectName)
  const setProjectAspect = useEditorStore((state) => state.setProjectAspect)
  const setFps = useEditorStore((state) => state.setFps)
  const fps = useEditorStore((state) => state.timeline.fps)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  /**
   * The project waiting to be applied, and what it still needs. The text lives in
   * a ref as well as in state: the file inputs' handlers are async, and a stale
   * closure must not be able to lose the project between two clicks.
   */
  const pendingRef = useRef<ProjectFile | null>(null)
  const [importNote, setImportNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(
    null,
  )
  /** What the local server can see: the artist's projects, and every media file. */
  const [progress, setProgress] = useState<{ done: number; total: number; error?: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // 离开网站前，未保存的改动要拦一下。
  // 桌面端不用浏览器的 beforeunload（在 Electron 里会卡住窗口关闭、关不掉），
  // 桌面端的关闭/未保存保护交给主进程处理。
  useEffect(() => {
    if (hasNativePicker()) return
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const commitName = () => {
    setEditing(false)
    const name = draft.trim() || '未命名项目'
    if (name !== project.name) setProjectName(name)
    setDraft(name)
  }

  /**
   * 导入工程: read the text, pull the media it mentions into the library, apply it.
   *
   * Everything a project needs is in one folder in practice, so a folder choice
   * does all three in a single click; picking the `.txt` alone is there for when
   * the assets are already in the library (or already loaded).
   */
  const loadMedia = async (files: File[]): Promise<number> => {
    if (files.length === 0) return 0
    // Reading a folder of clips takes a while; say so rather than looking stuck.
    setImportNote({ tone: 'warn', text: t('正在导入 {n} 个素材…', { n: files.length }) })
    const result = await useEditorStore.getState().importMediaFiles(files)
    if (result.problems.length > 0) {
      setImportNote({ tone: 'warn', text: result.problems.join('；') })
    }
    return result.ids.length
  }

  /** Never leave the panel frozen on a failure: say what happened. */
  const guard = async (what: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      setImportNote({
        tone: 'bad',
        text: `${t(`${what}失败：`)}${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /**
   * Apply a project. It is applied even when素材 is still missing — the frames that
   * need a missing file are skipped and reported, everything else lands, and the
   * panel offers to fill the gap. Applying again after filling it is idempotent.
   */
  const applyProject = async (project: ProjectFile, loaded: number) => {
    const store = useEditorStore.getState()
    const result = store.applyProjectText(project.text, project.path)
    const stillMissing = missingResources(project, useEditorStore.getState().media)
    pendingRef.current = project
    if (result.errors.length > 0) {
      setImportNote({ tone: 'bad', text: result.errors.join('；') })
      return
    }
    const parts = [t('已导入《{name}》', { name: useEditorStore.getState().project.name })]
    if (loaded > 0) parts.push(t('新素材 {n} 个', { n: loaded }))
    parts.push(
      t('关键帧 {n} 个', {
        n: useEditorStore.getState().objects.reduce((total, o) => total + o.keyframes.length, 0),
      }),
    )
    if (stillMissing.length > 0)
      parts.push(t('缺素材 {n} 个，已跳过相关帧', { n: stillMissing.length }))
    setImportNote({ tone: stillMissing.length > 0 ? 'warn' : 'ok', text: parts.join(' · ') })
    if (stillMissing.length === 0) window.setTimeout(() => setImportOpen(false), 1400)
    // A freshly imported project is the new baseline: nothing to save yet.
    markClean()
  }

  const onProjectFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    await guard('导入工程', async () => {
      const project = readProjectText(file.name, await readFileText(file))
      pendingRef.current = project
      setImportNote(null)
      await applyProject(project, 0)
      // A single picked file does not bring its siblings, so the local server is
      // asked to find the resources the code names and hand them over — that is
      // the "导入工程文件自动带资源" the format promises.
      const still = missingResources(project, useEditorStore.getState().media)
      if (still.length > 0) {
        const fetched = await loadResourcesByName(still)
        if (fetched.length > 0) {
          const loaded = await loadMedia(fetched)
          await applyProject(project, loaded)
        }
      }
    })
  }

  /**
   * 导入一个文件夹：读出工程，再把代码按**相对路径**点名的素材直接取进来。
   *
   * Both entry points land here — the File System Access picker (one click, and
   * the only one that can read a sibling of the `.txt` the artist chose) and the
   * `<input webkitdirectory>` fallback.
   */
  const importFolder = async (entries: FolderEntry[]) => {
    const all = entries.map((entry) => withRelativePath(entry.file, entry.path))
    const candidates = projectCandidates(all)
    if (candidates.length === 0) {
      setImportNote({ tone: 'bad', text: '这个文件夹里没有工程文件（.txt）' })
      return
    }
    // A folder can hold several text files; the project is the one that parses.
    let project: ProjectFile | null = null
    for (const candidate of candidates) {
      const read = readProjectText(
        candidate.name,
        await readFileText(candidate),
        relativeOf(candidate),
      )
      if (read.errors.length === 0) {
        project = read
        break
      }
      project = project ?? read
    }
    if (!project) return
    pendingRef.current = project
    // Only what the code mentions: the folder may also hold renders and notes.
    const loaded = await loadMedia(mediaFilesFor(all, project))
    await applyProject(project, loaded)
  }

  const onProjectFolder = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    await guard('导入工程文件夹', async () => {
      await importFolder(Array.from(files).map((file) => ({ path: relativeOf(file), file })))
    })
  }

  /** The one-click path: pick the folder the code lives in, read it directly. */
  const onPickFolder = async () => {
    // 桌面端：原生选工程文件 → 以它所在目录为根，按相对路径读素材。
    if (hasNativePicker()) {
      await guard('导入工程', async () => {
        const entries = await nativePickFolder()
        if (!entries || entries.length === 0) return
        await importFolder(entries)
      })
      return
    }
    if (!canPickDirectory()) {
      folderRef.current?.click()
      return
    }
    await guard('导入工程文件夹', async () => {
      const entries = await pickFolder()
      if (!entries || entries.length === 0) return
      await importFolder(entries)
    })
  }

  /** 「导入工程」按钮：桌面端走原生目录读取，网页版走单文件选择。 */
  const onImportProject = () => {
    if (hasNativePicker()) {
      void onPickFolder()
      return
    }
    fileRef.current?.click()
  }

  const onExportFrame = async () => {
    // A video backdrop has to be on the right frame before the shot is drawn.
    await seekBackdropVideo(useEditorStore.getState().timeline.currentTime)
    // The shot pass renders one clean frame at the project's aspect.
    const dataUrl = await requestShotCapture()
    if (dataUrl) downloadDataUrl(dataUrl, `${project.name || 'shot'}.png`)
    setExportOpen(false)
  }

  /** 保存: write into the workspace when local, download otherwise. */
  const onSave = async () => {
    const text = toProjectText(useEditorStore.getState())
    const name = project.name || '未命名项目'
    const saved = await saveProject(name, text)
    if (!saved) {
      // No local endpoint (a static deployment): saving is just exporting.
      downloadBlob(new Blob([text], { type: 'text/plain; charset=utf-8' }), `${name}.txt`)
    }
    markClean()
  }

  /** 导出工程文件: always a download of the project text. */
  const onExportProject = () => {
    const text = toProjectText(useEditorStore.getState())
    downloadBlob(
      new Blob([text], { type: 'text/plain; charset=utf-8' }),
      `${project.name || '未命名项目'}.txt`,
    )
    setExportOpen(false)
  }

  const onExportVideo = async () => {
    const store = useEditorStore.getState()
    const duration = lastKeyframeTime(store.objects, store.timeline.cameraKeyframes)
    if (duration <= 0) {
      setProgress({ done: 0, total: 0, error: '影片长度是 0 —— 先打第二个关键帧' })
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ done: 0, total: Math.round(duration * store.timeline.fps) })
    try {
      const result = await exportVideo(
        {
          project: store.project,
          objects: store.objects,
          media: store.media,
          customFonts: store.customFonts,
          selectedObjectId: store.selectedObjectId,
          clipboard: store.clipboard,
          camera: store.camera,
          view: store.view,
          scene: store.scene,
          timeline: store.timeline,
          ui: store.ui,
        },
        (time) => useEditorStore.getState().seek(time),
        {
          fps: store.timeline.fps,
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        },
      )
      downloadBlob(result.blob, `${project.name || 'movie'}.mp4`)
      setProgress(null)
      setExportOpen(false)
    } catch (error) {
      setProgress({
        done: 0,
        total: 0,
        error: error instanceof Error ? error.message : '导出失败',
      })
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand__mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <path
              d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 12v9M12 12 4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <span className="brand__name">{t('简辑')}</span>
      </div>

      <Tip label={t('保存工程')} side="bottom">
        <button
          type="button"
          className="topbar__save"
          aria-label={t('保存工程')}
          onClick={() => void onSave()}
        >
          <Save size={15} />
        </button>
      </Tip>

      <div className="topbar__project">
        {editing ? (
          <input
            ref={inputRef}
            className="ui-input topbar__project-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName()
              if (event.key === 'Escape') {
                setDraft(project.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <Tip label="点击重命名项目" side="bottom">
            <button
              type="button"
              className="topbar__project-name"
              onClick={() => {
                setDraft(project.name)
                setEditing(true)
              }}
            >
              {project.name}
            </button>
          </Tip>
        )}
      </div>

      <div className="topbar__spacer" />

      <div className="topbar__group">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="langmenu__trigger" aria-label={t('界面语言')}>
              <span className="langmenu__flag">
                {LOCALES.find((entry) => entry.id === locale)?.flag}
              </span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="langmenu" sideOffset={6} align="end">
              {LOCALES.map((entry) => (
                <DropdownMenu.Item
                  key={entry.id}
                  className="langmenu__item"
                  onSelect={() => setLocale(entry.id)}
                >
                  <span className="langmenu__flag">{entry.flag}</span>
                  <span className="langmenu__label">{entry.label}</span>
                  {entry.id === locale ? <span className="langmenu__check">✓</span> : null}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button
          variant="ghost"
          icon={<Settings2 size={14} />}
          onClick={() => setSettingsOpen(true)}
        >
          {t('设置')}
        </Button>
        <Tip label={t('导入工程：读工程文本，并把代码里提到的素材拉进素材区')}>
          <Button icon={<Upload size={14} />} onClick={() => setImportOpen(true)}>
            {t('导入')}
          </Button>
        </Tip>
        <Button
          variant="primary"
          icon={<Download size={14} />}
          onClick={() => setExportOpen(true)}
        >
          {t('导出')}
        </Button>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        {exportOpen ? (
          <DialogContent title={t('导出')} width={420}>
            {progress ? (
              <div className="export">
                {progress.error ? (
                  <div className="code__line code__line--error">{progress.error}</div>
                ) : (
                  <>
                    <div className="export__row">
                      <span>
                        {t('正在导出 MP4 · 第 {done} / {total} 帧', {
                          done: progress.done,
                          total: progress.total,
                        })}
                      </span>
                      <span className="export__pct">
                        {progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="export__bar">
                      <div
                        className="export__bar-fill"
                        style={{
                          width: `${
                            progress.total > 0 ? (progress.done / progress.total) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                    <p className="ui-dialog__note">
                      {t('逐帧求值后编码，所以画面是确定的；窗口请保持在前台，导出期间别切走。')}
                    </p>
                  </>
                )}
                <div className="export__actions">
                  {progress.error ? null : (
                    <Button
                      onClick={() => {
                        abortRef.current?.abort()
                        setProgress(null)
                      }}
                    >
                      {t('取消')}
                    </Button>
                  )}
                  {progress.error ? (
                    <Button variant="primary" onClick={() => setProgress(null)}>
                      {t('好')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="export__option" onClick={() => void onExportVideo()}>
                  <Film size={18} />
                  <span>
                    <b>{t('整片 MP4')}</b>
                    <em>
                      {project.aspect} · {fps}fps · H.264
                    </em>
                  </span>
                </button>
                <button type="button" className="export__option" onClick={() => void onExportFrame()}>
                  <FileImage size={18} />
                  <span>
                    <b>{t('当前帧 PNG')}</b>
                    <em>{t('按摄像机取景、按画幅裁切，透明背景')}</em>
                  </span>
                </button>
                <button type="button" className="export__option" onClick={onExportProject}>
                  <FileCode2 size={18} />
                  <span>
                    <b>{t('工程文件')}</b>
                    <em>{t('工程即文本：保存成 .txt，可在别的机器上再导入')}</em>
                  </span>
                </button>
              </>
            )}
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) {
            pendingRef.current = null
            setImportNote(null)
          }
        }}
      >
        {importOpen ? (
          <DialogContent title={t('导入工程')} width={420}>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.uae2,text/plain"
              hidden
              onChange={(event) => {
                void onProjectFile(event.target.files)
                event.target.value = ''
              }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              hidden
              {...({ webkitdirectory: '' } as Record<string, string>)}
              onChange={(event) => {
                void onProjectFolder(event.target.files)
                event.target.value = ''
              }}
            />
            <button
              type="button"
              className="export__option"
              onClick={() => onImportProject()}
            >
              <FileCode2 size={18} />
              <span>
                <b>{t('导入工程')}</b>
                <em>{t('读 .txt 并按代码里的相对路径自动读入本地素材')}</em>
              </span>
            </button>
            <button
              type="button"
              className="export__option"
              onClick={() => void onPickFolder()}
            >
              <FolderOpen size={18} />
              <span>
                <b>{t('导入文件夹')}</b>
                <em>{t('一步到位：文件夹里的工程文本会被读出，里面提到的图片 / 视频会自动进素材区')}</em>
              </span>
            </button>

            {importNote ? (
              <div className={`code__line code__line--${importNote.tone === 'bad' ? 'error' : 'plain'}`}>
                {importNote.text}
              </div>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen ? (
          <DialogContent title={t('设置')} width={380}>
            <div className="ui-field">
              <div className="ui-field__label">{t('画幅')}</div>
              <Segmented
                wide
                value={project.aspect}
                options={ASPECTS}
                onChange={(aspect) => setProjectAspect(aspect)}
              />
            </div>
            <SelectField
              label={t('帧率')}
              value={String(fps)}
              options={FPS_OPTIONS}
              onChange={(value) => setFps(Number(value))}
            />
            <p className="ui-dialog__note">
              {t('画幅决定右下角拍摄小窗、播放弹窗与导出图的比例 —— 当前')} {project.aspect}（
              {ASPECT_RATIO[project.aspect].toFixed(2)} : 1）。
            </p>
          </DialogContent>
        ) : null}
      </Dialog>
    </header>
  )
}
