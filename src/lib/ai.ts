import { requestShotCapture } from './capture'
import { useEditorStore } from '../store/editorStore'
import { PROVIDERS, type AIConfig } from './aiConfig'
import type { MediaContext } from './mediaAnalysis'

/**
 * AI 对话：客户端代理循环。
 *
 * The LLM is a director: it plans the storyboard first, then emits a complete
 * project file and applies it through `apply_project`, and iterates on the result
 * by looking at `capture_frame` screenshots. The loop runs here (not on the
 * server) because both tools touch the browser — the store and the WebGL shot.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: unknown
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

const SYSTEM_PROMPT = `你是「简辑」3D 动画编辑器的 AI 动画导演兼美术指导。你的目标不是"能用"，而是"精美"：把用户的需求拍成一条构图讲究、节奏有设计、动效有层次、转场有巧思的动画短片。

【导演思维 —— 先构思，再动手，必须自检】
1. 拿到需求先写「分镜脚本」：镜头号 / 时间 / 哪个对象 / 做什么动作 / 屏幕上放什么 / 用什么景别与构图。在心里把整条片从头到尾过一遍再写。
2. 每个镜头都要有「设计意图」：为什么这样构图、为什么这个节奏、这段和下一段怎么接（转场）。不要机械地把对象往场景里一摆。
3. 把分镜翻译成关键帧：每个动作至少两个关键帧（起点 + 终点），中间自动插值；复杂动作拆成多段（起势 → 主动作 → 收势），节奏快慢有变化。
4. 写完后用 apply_project 应用，然后【必须】用 capture_frame 截图逐镜自查画面；构图丑、留白不对、文字看不清、节奏不对，就改工程文件重新 apply，反复迭代，直到自己满意才给最终答复。不要一次就交差。

【工程文件语言（完整语法，务必用对）】
- 纯文本，第一行固定为 \`# 简辑 · 工程文件 v1\`。一行一件事；\`#\` 是注释；字段用空白分隔 \`key=value\`，值内不能有空格；列表 \`[a,b,c]\`；含空格的名字/路径加双引号（\`\\"\` 转义）；别名先声明后使用。
- 项目：\`project = 名字\`、\`aspect = 16:9|9:16|1:1|4:5|21:9\`、\`fps = 30\`。
- 素材：\`别名 = media:路径\`（图片/视频，路径相对本工程文件）。
- 对象声明：\`别名 = model:<设备id> ["名字"] [color=#hex轨道色]\`；\`别名 = image:<素材别名>\`；\`别名 = video:<素材别名>\`；\`别名 = text ["名字"]\`（下一行缩进写 \`  text …\`，见下）。
- 文字对象（text 行）：\`text font=<字体> size=<字号> color=#ffffff opacity=<0..1> align=left|center|right spacing=<字距> lineheight=<行高> wrap=<0不换行|1换行> content="…"\`。字号参考：标题 0.6~1.0，正文 0.25~0.4（世界单位）。**spacing 也是世界单位，正常 0.02~0.3（标题最多 0.4），绝不要写 4、13、26、30 这种大数**——那会把每个字隔开几十个单位，整行字散出画面之外。
- **文字宽度估算（防止冲出画框）**：一个字 ≈ size 宽（拉丁/数字 ≈ size×0.55），再加 spacing×(字数−1)。16:9 画面宽约 5.1 单位，一行中文最多约 16 字（size=0.3）；"MacBook Pro"（11 个拉丁字母）在 size=0.96 时已约 5.5 单位、必然顶边——标题要么更短，要么 size ≤ 0.7。**宁可字小留白，也不要让文字贴边或出画**。
- 关键帧：\`@别名 t=<秒> p=[x,y,z] s=<开合角|-> a=[rx,ry,rz] sc=[sx,sy,sz] f=<素材别名|-> v=<变速> [hid|hid=fade|vis=fade] [scene=…] [chain]\`
- 视频片段：\`@别名.clip <片段id> m=<素材别名> t=<开始秒> in=<源入点> out=<源出点> v=<变速>\`

【可用设备】
- macbook-pro-13-2020（MacBook：可开合 s 0..135，默认开 120，可贴屏，屏幕宽高比 1.595）
- iphone-16-pro-max（手机：s 必须写 -，竖屏 0.47）
- xiaomi-17-pro-max（手机：s 必须写 -，竖屏 0.456）
- gaming-laptop（游戏本：可开合 s 0..180，180=摊平，屏幕 2.17）

【可用字体（text font=…）】
- wenkai（霞鹜文楷，默认，中英，典雅/古典）、dejavu、dejavu-bold（拉丁）
- 思源黑体（现代/科技），文件名必须写全（带字重后缀）：Source_Han_Sans_SC_Regular.otf、Source_Han_Sans_SC_Light_Light.otf、Source_Han_Sans_SC_Medium_Medium.otf、Source_Han_Sans_SC_Bold.otf、Source_Han_Sans_SC_Heavy_Heavy.otf、Source_Han_Sans_SC_ExtraLight_ExtraLight.otf、Source_Han_Sans_SC_Normal_Normal.otf
- 思源宋体（正式/庄重）：Source_Han_Serif_SC_Light_Light.otf
- 阿里巴巴普惠体（通用/大气）：Alibaba_PuHuiTi_2.0_55_Regular_55_Regular.ttf，字重后缀 35_Thin / 45_Light / 65_Medium / 75_SemiBold / 85_Bold / 95_ExtraBold / 105_Heavy / 115_Black
- 阿里妈妈方圆体 AlimamaFangYuanTiVF-Thin.ttf（圆润可爱）、阿里妈妈数黑体 AlimamaShuHeiTi-Bold.ttf（标题）、阿里妈妈东方大楷 AlimamaDongFangDaKai-Regular.ttf（书法）
- 钉钉进步体 DingTalk-JinBuTi.ttf、得意黑 SmileySans-Oblique-2.ttf、站酷酷黑 ZhanKuKuHei-1.ttf、站酷高端黑 GaoDuanHeiXiuDing151105-1.ttf、庞门正道 PangMenZhengDaoBiaoTiTiMianFeiBan-2.ttf、Nabla Nabla_Regular.ttf（彩色装饰）
- 字体按"气质"选：古典用楷/宋，科技现代用黑体，可爱用方圆，标题冲击用数黑/酷黑/得意黑。

【场景 / 背景（scene=…，逗号分隔，全局背景在第一帧写一次）】
\`scene=bg=gradient,color=#0b0f16,grad=#1d2534>#05070b,angle=160,env=1,exp=1,shadow=0.55:2.6\`
- bg=solid|gradient|none|media；color=底色；grad=#上色>#下色（渐变）；angle=渐变角度
- env=<0..2 环境光>（越大越亮越通透）、exp=<0..2 曝光>。**设备的金属外壳靠环境光反射，env 低于 0.7 或 exp 低于 0.85 会让设备几乎全黑、看不清**——想要暗色氛围可以用暗背景色，但 env 保持 0.9~1.2、exp 保持 0.95~1.1，主体才看得见。
- shadow=<透明度>:<模糊>（地面阴影，默认 0.55:2.6）
- bgmedia=<素材别名>、bgfit=cover|contain、bgoverlay（加暗色蒙层）、bgblur（背景模糊，突出主体）
- 氛围示例：高端深空 \`bg=gradient,color=#0b0f16,grad=#1d2534>#05070b,angle=160,env=1,exp=1\`；干净明亮 \`bg=solid,color=#f4f6f8,env=1.2,exp=1\`；暖色氛围 \`bg=gradient,color=#1a1208,grad=#3a2410>#0a0603,angle=140,env=0.9\`。

【美学与配色（别用默认值，否则画面寡淡）】
- **背景主动换**：每个镜头/段落用 scene= 换一套背景（渐变色 + env + exp），别整片只用一个默认深空背景。暗色段落用深蓝/墨绿渐变，明亮段落用浅灰/暖色，切换背景本身就能当转场。
- **字体主动换**：标题用有冲击力的（数黑体/站酷酷黑/得意黑），正文用思源黑体/普惠体，古典气质用霞鹜文楷/思源宋体/东方大楷；别全文只用默认 wenkai。
- **颜色主动换**：文字别全用纯白——主标题用亮色（#ffffff/#ffe4b8 等），副标题/说明用半透明的浅灰蓝（#a8c4de/#8d97a8），要点用品牌色（#4c8dff 蓝 / #f5a524 橙 / #2bb673 绿 / #e879f9 紫），颜色要与背景有对比、能看清。

【动效与转场（这是"精美"的关键）】
- 变速 v 同时就是缓动曲线：\`v=1\` 匀速（机械，尽量别用）；\`v=[0:0.4,1:1.8]\` 缓入；\`v=[0:1.8,1:0.4]\` 缓出；\`v=[0:0.5,0.6:1.4,1:0.9]\` 弹性；\`v=[0:2.2,0.5:0.35,1:2.2]\` 中间慢放强调；\`v=[0:0.35,0.45:2.6,0.75:2.6,1:0.35]\` 子弹时间。
- 淡入淡出：起始帧 \`hid\` + 结束帧 \`vis=fade\` = 淡入；结束帧 \`hid=fade\` = 淡出。设备屏幕会跟着机身一起淡。**淡入必须前一帧 hid、后一帧 vis=fade 两帧配合**；只在开头写 hid 而不写 vis=fade，对象会在下一帧瞬间硬切出现，不会有淡入。
- 转场常用做法：① 上一个对象在时间 t 淡出，下一个对象在 t 附近淡入（交叉叠化）；② 用动作遮挡（设备大幅旋转/掠过镜头）掩盖切换；③ 同一背景贯穿全片，只换前景对象，转场就自然。
- 运动节奏：进→停→出要有快慢；不要所有对象匀速直线；让动作错开 0.2~0.4 秒先后发生，画面更有层次。

【取景范围（算清楚内容会不会出画）】
- 摄像机固定：焦距 fov=30°，距目标点 [0,0.5,0] 约 5.4 单位，从正面稍俯视。画面中心就是原点附近：地面中心 [0,0,0]，视觉中心略高于地面约 0.5。
- 对象会自动缩放到「最长边 = 2 单位」并落在 y=0 地面。所以"一台设备 ≈ 2 单位"是构图的基本尺度，约占画面高度的 2/3。
- 以原点为参照，各画幅在目标距离处的可见范围（宽 × 高，单位）：
  16:9 ≈ 5.1 × 2.9（横向宽松，最多并排两台设备）
  9:16 ≈ 1.6 × 2.9（横向很窄，只能放一台，多余内容竖排）
  1:1 ≈ 2.9 × 2.9
  4:5 ≈ 2.3 × 2.9
  21:9 ≈ 6.8 × 2.9（横向极宽，适合大场面/多设备横排）
- 安全边距：16:9 下 x 超出 ±2.5、y 超过 +2 就会出画；9:16 下 x 超出 ±0.8 就会出画。文字、标题要放在这些范围内，并留出边缘安全区（约 0.3 单位）。
- 旋转/倾斜会让设备的一部分转向画面外；近处对象（把设备沿 z 轴拉近镜头）看起来更大。写位置和旋转时，先按"对象占 2 单位"估算它在画面里的占比，再决定 p 和 a。
- 【硬性警告】不要为了"张力/动感"把主体推到 x=±2.5 甚至出画（如 x=2.75、x=-2.35），也不要开场把**所有**对象都写 hid——否则观众大部分时间只看到背景、画面是空的。主体（设备）大部分时间要落在 x∈[-1.8,1.8]、y∈[0,1.8] 内；掠过边缘可以，但别长时间停在画外；开场至少让一个对象在 0.5 秒内出现。

【硬性约定（违反会报错）】
- 时间单位是秒；y=0 是地面（设备自动落地并缩放到 2 单位）；+z 朝向镜头；a=[rx,ry,rz] 是欧拉角（度）。
- 摄像机固定，绝不能写 @camera。
- 手机 s 必须写 \`-\`；笔记本 s 是 0..135 / 0..180。
- 无贴图写 \`f=-\`；默认屏幕是空白深色。
- 每个对象至少两个关键帧，否则视频时长为 0。
- apply_project 的 text 必须是完整工程文件，不能只给片段。**输出有长度上限，工程文件要精简——每个对象 3~6 帧就够，宁短勿断；太长会被截断导致整段作废。应用后必须用 capture_frame 截图确认真的有画面（至少截 1~2 个时间点），别只报"已应用"就交差。**
- 构图：主体别总在正中央，善用三分法；文字留出安全边距；注意对象之间不要重叠打架。
- **空间层级**：+z 朝向镜头。设备默认在 z=0；文字、贴图等前景对象要放在 **z ≥ 0**（与设备同面或更靠镜头，比如 z=0 或 z=+0.5），放在 z < 0（如 z=-1）会被设备挡住、看不到。`

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apply_project',
      description: '应用一份完整的工程文件（DSL 文本）到编辑器，生成或替换动画',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '完整的工程文件文本，第一行必须是「# 简辑 · 工程文件 v1」',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_frame',
      description: '截图当前（或指定时刻）的画面，返回压缩 JPEG，用于查看关键帧效果',
      parameters: {
        type: 'object',
        properties: {
          time: { type: 'number', description: '可选：先跳到这个时间点（秒）再截图' },
        },
      },
    },
  },
]

/* ------------------------------------------------------------ tools ---- */

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 压缩截图以节省 token：等比缩小到最长边 ≤ 512，JPEG q=0.7。 */
async function captureCompressed(time?: number): Promise<{ image: string; width: number; height: number }> {
  if (time !== undefined) useEditorStore.getState().seek(Math.max(0, time))
  // Let the store flush and the render pass draw one frame.
  await new Promise((resolve) => setTimeout(resolve, 250))
  // 兜底超时：渲染通道若没响应（后台标签 / 上下文丢失），不能把代理循环挂死。
  const png = await Promise.race([
    requestShotCapture(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
  ])
  if (!png) throw new Error('截图超时：渲染通道没有响应')
  const img = await loadImage(png)
  const maxEdge = 512
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('截图失败：无法创建画布')
  ctx.drawImage(img, 0, 0, width, height)
  return { image: canvas.toDataURL('image/jpeg', 0.7), width, height }
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'apply_project') {
    const text = typeof args.text === 'string' ? args.text : ''
    // 空 / 被截断的工程文本不能应用——那会把上一版工程清成空白。
    if (!text.trim()) {
      return JSON.stringify({ ok: false, applied: false, errors: ['工程文件为空（工具参数可能被截断），未应用'] })
    }
    if (!text.includes('# 简辑')) {
      return JSON.stringify({ ok: false, applied: false, errors: ['工程文件缺少「# 简辑 · 工程文件 v1」头，未应用'] })
    }
    const store = useEditorStore.getState()
    const result = store.applyProjectText(text)
    // 工具结果用 JSON 字符串：纯文本供应商（DeepSeek）要求 content 是 string。
    return JSON.stringify({
      ok: result.errors.length === 0,
      errors: result.errors,
      warnings: result.warnings,
      applied: result.errors.length === 0,
    })
  }
  if (name === 'capture_frame') {
    const time = typeof args.time === 'number' ? args.time : undefined
    const shot = await captureCompressed(time)
    // 多模态工具结果：文本 + 图片（仅视觉模型会调用）。
    return [
      { type: 'text', text: `画面截图（${shot.width}×${shot.height}，已压缩）` },
      { type: 'image_url', image_url: { url: shot.image } },
    ]
  }
  return JSON.stringify({ error: `未知工具 ${name}` })
}

/* ------------------------------------------------------------- loop ---- */

/**
 * 跑一轮代理：把历史消息交给模型，模型要调用工具就执行并继续，直到它给出文本回复。
 * 返回最终文本，并把整个过程中新增的消息写入 `history`。
 */
export async function runAgent(
  history: ChatMessage[],
  projectText: string,
  config: AIConfig,
  mediaContext: MediaContext,
): Promise<{ text: string; error?: string }> {
  const vision = PROVIDERS[config.provider].vision
  // 纯文本供应商（DeepSeek）不支持图像，也不该拿到截图工具。
  const tools = vision ? TOOLS : TOOLS.filter((tool) => tool.function.name !== 'capture_frame')

  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n【可用本地素材】\n${mediaContext.text}` },
  ]
  // 视觉模型先"看"素材采样画面；纯文本供应商（DeepSeek）跳过图片。
  if (vision && mediaContext.samples.length > 0) {
    const content: unknown[] = [
      { type: 'text', text: '以下是对本地素材的采样画面（图片为缩略图，视频为按时间抽帧），用于理解素材含义：' },
    ]
    for (const sample of mediaContext.samples) {
      const label = sample.time !== undefined ? `${sample.name} @${sample.time.toFixed(1)}s` : sample.name
      content.push({ type: 'text', text: label })
      content.push({ type: 'image_url', image_url: { url: sample.image } })
    }
    messages.push({ role: 'user', content })
  }
  messages.push({ role: 'user', content: `当前工程文件：\n\`\`\`\n${projectText}\n\`\`\`` })
  messages.push(...history)

  for (let round = 0; round < 12; round += 1) {
    const response = await fetch('/__ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages,
        tools,
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const hint =
        response.status === 401
          ? 'API Key 无效或已过期'
          : response.status === 402
            ? '额度用尽或需要充值'
            : response.status === 429
              ? '请求过于频繁（限流）或额度用尽'
              : response.status === 404
                ? '模型不存在（检查模型名）'
                : ''
      const detail = (() => {
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } | string }
          return typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error?.message ?? body
        } catch {
          return body
        }
      })()
      return {
        text: '',
        error: `AI 服务不可用（HTTP ${response.status}${hint ? ` · ${hint}` : ''}）：${detail}`,
      }
    }
    const data = (await response.json()) as {
      choices?: Array<{ message: { role: string; content?: string; tool_calls?: ChatMessage['tool_calls'] } }>
    }
    const message = data.choices?.[0]?.message
    if (!message) return { text: '', error: 'AI 返回为空' }

    if (message.tool_calls && message.tool_calls.length > 0) {
      const assistantContent = message.content ?? ''
      // 工具调用的中间消息只在本轮 messages 里流转，不进历史（否则下次会回放
      // 没有配套 tool 结果的 assistant 消息，DeepSeek/OpenAI 都会报错）。
      messages.push({ role: 'assistant', content: assistantContent, tool_calls: message.tool_calls })
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          args = {}
        }
        let result: unknown
        try {
          result = await executeTool(call.function.name, args)
        } catch (error) {
          result = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
      continue
    }

    const text = message.content ?? ''
    if (text) history.push({ role: 'assistant', content: text })
    return { text }
  }

  return { text: '', error: '达到最大工具调用轮数' }
}
