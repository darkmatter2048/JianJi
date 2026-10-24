import { useCallback } from 'react'
import { create } from 'zustand'

/**
 * 界面语言.
 *
 * The editor is written in Chinese first, so the **Chinese string is the key** and
 * a language is a lookup table over it. That keeps the `zh` path trivially
 * correct (no key to forget) and means a missing translation falls back to the
 * original rather than to an empty box. `{name}`-style placeholders carry the
 * values that used to sit inside template literals.
 */

export type Locale = 'zh' | 'en'

export const LOCALES: Array<{ id: Locale; flag: string; label: string }> = [
  { id: 'zh', flag: '🇨🇳', label: '中文' },
  { id: 'en', flag: '🇬🇧', label: 'English' },
]

const STORAGE_KEY = 'uae2.locale'

const EN: Record<string, string> = {
  // brand
  简辑: 'JianJi',

  // top bar
  导入: 'Import',
  设置: 'Settings',
  导出: 'Export',
  '界面语言': 'Language',
  AI: 'AI',
  'AI 对话：构思分镜，生成动画': 'AI chat: plan the storyboard, then generate the animation',
  'AI 动画导演': 'AI animation director',
  '告诉我你想做什么动画，例如：': 'Tell me what animation you want, e.g.:',
  '“让 MacBook 从合上到打开，屏幕播放视频，标题淡入”':
    '“Open the MacBook, play a video on its screen, and fade in a title”',
  '思考中…': 'Thinking…',
  '描述你的动画需求…': 'Describe the animation you want…',
  'AI 供应商设置': 'AI provider settings',
  '导出对话记录': 'Export conversation',
  '清空对话': 'Clear conversation',
  '历史对话': 'History',
  '新建对话': 'New conversation',
  '下载对话': 'Download conversation',
  '删除对话': 'Delete conversation',
  '条消息': 'messages',
  '还没有历史对话。': 'No history yet.',
  '供应商': 'Provider',
  '模型': 'Model',
  '接口地址': 'API base URL',
  '正在读取素材并抽帧分析…': 'Reading assets and sampling frames…',
  '访问OrcaRouter': 'Visit OrcaRouter',
  'DeepSeek 为纯文本模型，无法查看截图，仅用文字描述理解素材。':
    'DeepSeek is text-only and cannot view screenshots; it understands assets from text descriptions.',
  导入工程: 'Import project',
  '导入文件夹': 'Import folder',
  '读 .txt 并按代码里的相对路径自动读入本地素材':
    'Read the .txt and load the local media its code references',
  '点击重命名项目': 'Click to rename project',
  '未命名项目': 'Untitled project',
  '导入工程：读工程文本，并把代码里提到的素材拉进素材区': 'Import project: read the text and pull in the media it references',

  // import dialog
  '选择工程文件夹': 'Choose project folder',
  '只选工程文件': 'Project file only',
  '一步到位：文件夹里的工程文本会被读出，里面提到的图片 / 视频会自动进素材区':
    'One step: the project text is read, and the images / videos it references are pulled into the library',
  '读 .txt 并按代码里的相对路径自动读入本地素材；素材已在素材区时也走这里':
    'Reads the .txt and auto-loads its local assets by the paths in the code; also the path for already-loaded assets',
  '补齐素材': 'Add missing assets',
  '这个文件夹里没有工程文件（.txt）': 'No project file (.txt) in this folder',
  '导入工程文件夹': 'Import project folder',
  '正在导入 {n} 个素材…': 'Importing {n} assets…',
  '正在应用工程…': 'Applying project…',
  '已导入《{name}》': 'Imported “{name}”',
  '新素材 {n} 个': '{n} new assets',
  '关键帧 {n} 个': '{n} keyframes',
  '缺素材 {n} 个': '{n} assets missing',
  '缺素材 {n} 个，已跳过相关帧': '{n} assets missing, related frames skipped',
  '补齐缺失的 {n} 个素材': 'Add the {n} missing assets',
  '按摄像机取景、按画幅裁切，透明背景': 'Shot framing, aspect cropped, transparent background',
  '画幅决定右下角拍摄小窗、播放弹窗与导出图的比例 —— 当前':
    'Aspect ratio drives the preview window, the player and the export — currently',
  '导入工程失败：': 'Import failed: ',
  '补齐素材失败：': 'Loading assets failed: ',
  '导入工程文件夹失败：': 'Importing folder failed: ',
  '按文件名兜底匹配：': 'Matched by file name: ',
  '这个仓库里的工程（素材按代码里的相对路径直接从磁盘读入）：':
    'Projects in this repository (assets read from disk by the paths in the code):',
  ' · 正在读取…': ' · reading…',
  '素材已在素材区（或本来就缺）时用这个：只读 .txt 并应用':
    'Use when assets are already loaded (or genuinely absent): reads and applies the .txt only',
  '引用是按': 'References are matched by',
  '对上的，所以补齐的文件名要和代码里写的一致。':
    'file name, so the files you add must be named exactly as written in the code.',
  '影片长度是 0 —— 先打第二个关键帧': 'The piece is 0s long — key a second frame first',

  // export dialog
  '整片 MP4': 'Full MP4',
  '当前帧 PNG': 'Current frame PNG',
  '工程文件': 'Project file',
  '工程即文本：保存成 .txt，可在别的机器上再导入':
    'The project is text: save as .txt and import it on another machine',
  '保存工程': 'Save project',
  '正在导出 MP4 · 第 {done} / {total} 帧': 'Exporting MP4 · frame {done} / {total}',
  '逐帧求值后编码，所以画面是确定的；窗口请保持在前台，导出期间别切走。':
    'Encoded frame-by-frame, so the result is deterministic; keep the window in front while exporting.',
  取消: 'Cancel',
  好: 'OK',
  导出失败: 'Export failed',
  '导出已取消': 'Export cancelled',
  '这台浏览器没有可用的 H.264 编码器（WebCodecs）': 'No H.264 encoder (WebCodecs) available in this browser',
  '这台浏览器不支持 WebCodecs，无法导出 MP4': 'This browser lacks WebCodecs, cannot export MP4',

  // settings
  画幅: 'Aspect ratio',
  帧率: 'Frame rate',

  // navigation
  素材: 'Assets',
  资源: 'Resources',
  设备: 'Devices',
  文字: 'Text',
  代码: 'Code',

  // timeline
  时间轴: 'Timeline',
  播放: 'Play',
  暂停: 'Pause',
  撤回: 'Undo',
  重做: 'Redo',
  '撤回上一步 · Ctrl+Z': 'Undo · Ctrl+Z',
  '重做下一步 · Ctrl+Y': 'Redo · Ctrl+Y',
  '在播放头打关键帧': 'Key a frame at the playhead',
  '在播放头剪开选中的视频 · X': 'Split the selected clip at the playhead · X',
  '删除选中的视频片段 · Del': 'Delete the selected clip · Del',
  '删除选中的关键帧 · Del': 'Delete the selected keyframe · Del',
  '先选中一段视频，并把播放头移到它中间': 'Select a clip and put the playhead inside it',
  '先选中一个关键帧或一段视频': 'Select a keyframe or a clip first',
  '先选中片段': 'Select a clip first',
  '跳到这一帧': 'Jump to this frame',
  '从此处重绘': 'Redraw from here',
  '从此处剪开': 'Split here',
  '把这一帧的状态写进这个对象后面所有关键帧': 'Write this frame’s state into all later keyframes of this object',
  '清空这个对象的关键帧': 'Clear this object’s keyframes',
  '删除文字': 'Delete text',
  '隐藏这个对象': 'Hide object',
  '显示这个对象': 'Show object',
  '调节关键帧的位置': 'Adjust keyframe position',
  '后面没有关键帧': 'no keyframes after this one',
  ' · 重绘链上，切到下一帧会把这一帧的状态带过去': ' · on the redraw chain; advancing carries this state forward',
  '关键帧 4 如果有': 'keyframe 4 if present',

  // inspector
  对象: 'Object',
  变速: 'Speed',
  场景: 'Scene',
  '未选中对象。': 'No object selected.',
  名称: 'Name',
  隐藏: 'Hide',
  '切换方式': 'Transition',
  '瞬间消失 / 显示': 'Instant hide / show',
  '渐隐 / 渐显': 'Fade out / in',
  '屏幕贴图': 'Screen texture',
  '拖入或点击选择图片 / 视频': 'Drag in or click to pick an image / video',
  '换一张图': 'Replace image',
  '改贴图': 'Change texture',
  '改场景': 'Change scene',
  '这个模型没有屏幕材质，无法贴图。': 'This model has no screen material, cannot texture it.',
  '切到「库」标签页添加一个。': 'Switch to the Library tab to add one.',
  '屏幕上还没有贴图。': 'No texture on the screen yet.',
  内容: 'Content',
  字体: 'Font',
  字号: 'Size',
  字距: 'Letter spacing',
  行高: 'Line height',
  对齐: 'Align',
  '不透明度': 'Opacity',
  '换行宽度': 'Wrap width',
  '不换行': 'No wrap',
  左: 'Left',
  右: 'Right',
  中: 'Center',
  颜色: 'Color',
  '复位位置': 'Reset position',
  '节点数': 'Nodes',
  '对于首帧，此设置无效。': 'This has no effect on the first frame.',
  '两个关键帧之间的那一段，就是这里要调的内容。': 'The span between two keyframes is what this adjusts.',
  '这一段的播放速度': 'Playback speed of this span',
  '匀速': 'Constant',
  '缓入': 'Ease in',
  '缓出': 'Ease out',
  '中间慢放': 'Slow middle',
  '升起再落下的一半': 'Half rise and fall',
  '子弹时间': 'Bullet time',
  '自转 360°': 'Spin 360°',
  '半圈环绕': 'Half orbit',
  '两帧之间绕 Y 轴转一整圈': 'A full turn around Y between two frames',
  '摄像机绕主体半圈': 'Half orbit of the camera around the subject',
  '摄像机拉近': 'Dolly in',
  '增加一个节点（按当前形状重采样）': 'Add a node (resampled to the current shape)',
  '减少一个节点（按当前形状重采样）': 'Remove a node (resampled to the current shape)',

  // scene tab
  背景: 'Background',
  纯色: 'Solid',
  渐变: 'Gradient',
  起点: 'From',
  终点: 'To',
  角度: 'Angle',
  照明: 'Lighting',
  '环境强度': 'Environment intensity',
  曝光: 'Exposure',

  // viewport HUD
  '复位视角': 'Reset view',
  '网格 · G': 'Grid · G',
  '安全区 / 网格': 'Safe area / grid',
  '切到摄像机视角': 'Switch to camera view',
  '退出摄像机视角': 'Exit camera view',
  '回到自由视角': 'Back to free view',
  '主视角 3/4': '3/4 main view',
  '复位到三视图机位': 'Reset to three-quarter camera',
  摄像机: 'Camera',
  '摄像机视角：拖动即回到自由视角并继续旋转 · 滚轮推拉镜头':
    'Camera view: drag returns to free view and keeps orbiting · wheel dollies',
  '未选中：拖动旋转 · 滚轮缩放视角 · 点击设备选中':
    'Nothing selected: drag orbits · wheel zooms · click a device to select',
  '已选中：拖动移动 · 拖圆环旋转 · 滚轮缩放 · 有动画时编辑会自动打在当前帧':
    'Selected: drag moves · ring drags rotate · wheel scales · edits auto-key on the current frame',
  '预览播放中：不能标记对象 —— 暂停后才能拖动 / 打帧 / 换贴图':
    'Previewing: cannot mark objects — pause before dragging / keying / changing texture',
  'Shift+滚轮 缩放视角': 'Shift+wheel zooms the view',
  '还没有任何关键帧。选中一个对象，把播放头移到位置，按': 'No keyframes yet. Select an object, move the playhead, press',
  '打一帧。': ' to key a frame.',
  '摄像机的关键帧不在这里 —— 在参数区「相机」栏里打。': 'Camera keyframes are not keyed here — they live in the inspector.',
  '只有起始帧，所以视频时长为': 'Only the start frame, so the duration is',
  '。把播放头移到后面、动一下对象或机位，再按': '. Move the playhead later, tweak an object or the camera, then press',
  '打第二帧，片子就有长度了。': ' to key a second frame and give the piece a length.',

  // player
  '播放效果视频': 'Play the piece',
  '播放进度': 'Playback progress',
  全屏: 'Fullscreen',
  关闭: 'Close',

  // assets sections
  '库里的素材': 'Library assets',
  '自己导入的图片 / 视频 / 音频': 'Your imported images / videos / audio',
  '点「导入」，或把文件拖进来。': 'Click Import, or drop files here.',
  '还没有素材。': 'No assets yet.',
  '设备库与场景中的设备': 'Device library and devices in the scene',
  '在此处搜索设备': 'Search devices here',
  '把 glTF 放进 public/models/，再到 lib/assets.ts 注册即可。': 'Drop a glTF into public/models/ and register it in lib/assets.ts.',
  '场景里还没有设备。': 'No devices in the scene yet.',
  '添加到场景': 'Add to scene',
  '已在场景中，点击选中': 'In the scene, click to select',
  '从场景中移除': 'Remove from scene',
  '从项目中删除': 'Delete from project',
  '新建文字': 'New text',
  '点上面的「新建文字」加一条，然后在 3D 场景里拖动或用参数区调整。':
    'Click “New text” above, then drag it in the scene or adjust it in the inspector.',
  '还没有文字。': 'No text yet.',
  '3D 文字对象': '3D text object',
  '3D 模型': '3D model',
  '图片 / 视频平面': 'Image / video plane',
  '屏幕贴图测试卡 · 16:10 · 1024 × 642': 'Screen texture test card · 16:10 · 1024 × 642',
  'glTF 2.0 · 含贴图': 'glTF 2.0 · textured',
  电脑: 'Computer',
  笔记本: 'Laptop',

  // code panel
  '工程即文本：查看 / 编辑 / 应用': 'Project as text: view / edit / apply',
  '语法速查': 'Syntax cheat sheet',

  // fonts / materials
  '霞鹜文楷': 'LXGW WenKai',
  '拉丁字母 · 0.7 MB': 'Latin · 0.7 MB',
  '拉丁字母 · 粗体 · 0.7 MB': 'Latin · bold · 0.7 MB',
  '中英文 · 18 MB': 'Chinese + Latin · 18 MB',
  '当前字体不含中文字形，切到「霞鹜文楷」才能显示中文。':
    'This font has no CJK glyphs; switch to “LXGW WenKai” to show Chinese.',
  测试卡: 'Test card',
  '深空灰': 'Space grey',
  '午夜蓝': 'Midnight blue',
  '陶瓷白': 'Ceramic white',
  '暗夜工作室': 'Dark studio',
  '雾光': 'Fog light',
  '薄荷': 'Mint',
  '日落': 'Sunset',
  '黏土预览': 'Clay preview',
  '原模型材质': 'Original model material',
  金: 'Gold',
  标准: 'Standard',

  // misc
  未知: 'Unknown',
  内屏: 'Screen',
  '显示名': 'Display name',
  '文件名': 'File name',
  封面: 'Cover',
  侧面: 'Side',
  俯视: 'Top',
  '低角度': 'Low angle',
  '全身': 'Full body',
  '特写': 'Close-up',
  '广角': 'Wide',
  推近: 'Dolly in',
  浮起: 'Float up',
  正面: 'Front',
  复制: 'Copy',
  剪切: 'Cut',
  '粘贴到播放头': 'Paste at playhead',
  '剪贴板是空的': 'Clipboard is empty',
  '自动计算时长并调节关键帧位置': 'Auto-compute duration and adjust keyframe positions',
  '视频片段变速': 'Clip speed',
  'X · 每段各自变速': 'X · each half gets its own speed',
  '视频解码失败：格式不受浏览器支持': 'Video decode failed: unsupported format',
  '音频解码失败：浏览器不支持该格式': 'Audio decode failed: unsupported format',
  '图片解码失败：文件可能已损坏': 'Image decode failed: the file may be corrupt',
  '读取超时：可能是浏览器不支持的编码（如 HEVC）': 'Read timed out: possibly an unsupported codec (e.g. HEVC)',
  '音频读取超时：可能是浏览器不支持的编码': 'Audio read timed out: possibly an unsupported codec',
  '解码失败：浏览器不支持该编码或封装格式': 'Decode failed: unsupported codec or container',
  '文件没有可用的画面轨道': 'The file has no usable video track',
  '正在校验…': 'Checking…',
  '透明 (可导出带通道)': 'Transparent (exports with alpha)',
  '同一份工程': 'The same project',
  '代码说的路径': 'The path in the code',
  '相机错位': 'Camera misaligned',
  '拖动播放头': 'Drag the playhead',
  '时间轴缩放': 'Timeline zoom',
  '清除': 'Clear',
  '删除': 'Delete',
  '删除对象': 'Delete object',
  平铺: 'Tile',
  裁剪: 'Crop',
  填充: 'Fill',
  '图片': 'Image',
  视频: 'Video',
  '（空）': '(empty)',
  '起点 → ': 'From → ',
  '渐隐 / 渐显（默认瞬间）': 'Fade (instant by default)',
  '当前帧 PNG（按摄像机取景、按画幅裁切、带背景）': 'Current frame PNG (shot framing, aspect cropped, with background)',
  '整片 MP4（逐帧求值 + H.264）': 'Full MP4 (frame-by-frame + H.264)',
  '导入工程（读工程文本，并把代码里提到的素材拉进素材区）': 'Import project (read the text and pull in the media it references)',
}

export function translate(
  locale: Locale,
  text: string,
  vars?: Record<string, string | number>,
): string {
  let out = locale === 'zh' ? text : (EN[text] ?? text)
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{${key}}`).join(String(value))
    }
  }
  return out
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    /* storage unavailable */
  }
  return 'zh'
}

export const useLocaleStore = create<{
  locale: Locale
  setLocale: (locale: Locale) => void
}>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* storage unavailable */
    }
    set({ locale })
  },
}))

export function useLocale(): Locale {
  return useLocaleStore((state) => state.locale)
}

/** A `t()` bound to the current language, re-bound when the language changes. */
export function useT(): (text: string, vars?: Record<string, string | number>) => string {
  const locale = useLocale()
  return useCallback(
    (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars),
    [locale],
  )
}
