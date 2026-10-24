# 简辑 · AI 创作知识库（v2）

> 你（AI）的任务：根据用户需求，**直接产出一份合法的「工程文件」文本**，编辑器导入后即渲染成视频。
> 你只需掌握：**① 输出什么格式的文本；② 有哪些资源可调用；③ 时间/运动/显隐/变速的语义；④ 如何自检。**

---

## 0. 一句话定义

输出永远是**纯文本**，第一行固定为 `# 简辑 · 工程文件 v1`。它本身就是项目：资源声明 + 每个对象一条独立时间线。

---

## 1. 心智模型（写之前必读）

- **时间单位是秒**（不是帧）。`fps` 只影响导出采样密度，不影响你写的时间值。
- **对象 = 一条独立时间线**，由关键帧序列组成。类型：`model`（3D 设备）/ `image` / `video`（图片/视频平面）/ `text`（3D 文字）。
- **关键帧 = 一个姿势**：`t` 时刻的位置/旋转/缩放/开合/贴图 + 从上一帧到这一帧的变速与显隐。
- **两帧之间自动插值**：想让对象动，就写两个不同时间的帧，中间不用写。
- **摄像机固定、不可键控**：不能出现 `@camera`（会报错）。运镜只能靠移动/旋转物体本身。
- **空间**：`p=[x,y,z]`，`y=0` 是地面（设备自动落地并缩放到 2 单位），`+z` 朝向镜头。`a=[rx,ry,rz]` 是欧拉角（度，XYZ）。

---

## 2. 输出契约：工程文件语言

**格式规则**：一行一件事；`#` 注释；字段用空白分隔的 `key=value`，**值内不能有空格**；列表用 `[a,b,c]`；含空格的名字/路径用双引号 `"…"`（`\"` 转义）；**别名先声明后使用**。

### 2.1 文件头 + 项目设置
```
# 简辑 · 工程文件 v1

project = 宣传片          # 工程名（可取到行尾，可含空格）
aspect = 16:9             # 16:9 | 9:16 | 1:1 | 4:5 | 21:9
fps = 30                  # 1..120
```

### 2.2 素材库（声明资源，给别名）
```
cover = media:素材/封面.png           # 图片（路径相对本工程文件）
intro = media:"assets/intro.mp4"      # 视频（含空格加引号）
```
- 行尾可附 `<秒>s` 和 `<宽>x<高>`，**仅作注释**，不参与解析。

### 2.3 对象声明
```
mac   = model:macbook-pro-13-2020 "MacBook" color=#f5a524
phone = model:iphone-16-pro-max
pic   = image:cover
clip  = video:intro
title = text "标题"
  text font=wenkai size=0.3 color=#ffffff align=center content="你好"
```
- 对象公共修饰：`color=#hex`（轨道色）、`appear=<秒>`（此时间后才出现）、`off`（初始隐藏）。
- 文字对象下一行缩进 `text …`：`font` / `size` / `color` / `opacity` / `align`（left/center/right）/ `spacing` / `lineheight` / `wrap`（0=不换行）/ `content="…"`。

### 2.4 关键帧（`@别名 …`）
```
@mac t=0.0 p=[0,0,0] s=120 a=[0,-20,0] f=cover v=1 vis=fade
@mac t=1.5 p=[0,0.3,0] s=105 a=[0,0,0] f=- v=1.25 hid=fade
```
| 字段 | 含义 | 省略时 |
|---|---|---|
| `t=<秒>` | 时间 | 0 |
| `p=[x,y,z]` | 位置 | 沿用 |
| `s=<度>` | 屏幕开合角；**无铰链设备写 `-`** | 沿用 |
| `a=[rx,ry,rz]` | 旋转（度，XYZ）| 沿用 |
| `sc=[sx,sy,sz]` | 缩放 | `[1,1,1]` |
| `f=<素材别名>` | 屏幕贴图；无贴图写 `-` | 沿用 |
| `v=<变速>` | 到达段变速（见 2.6）| 1 |
| `hid` / `hid=fade` / `vis=fade` | 显隐（见 3.3）| 显示 |
| `scene=…` | 场景（见 2.7）| 沿用 |
| `chain` | 把此帧状态写进后续所有帧 | — |

### 2.5 视频片段（`@别名.clip …`）
```
@mac.clip c1 m=intro t=0 in=0 out=2.8 v=1
```
第二个词是片段 id（任意）；`m` 引素材别名；`t` 开始秒；`in`/`out` 源入点/出点；`v` 变速。

### 2.6 变速 `v`
描述**从上一帧到这一帧**的播放速度（倍率，上限 4）：
- 匀速 `v=1`；曲线 `v=[t:v,t:v,…]`（t∈0..1）。
- 预设：`v=[0:0.4,1:1.8]` 缓入、`v=[0:1.8,1:0.4]` 缓出、`v=[0:2.2,0.5:0.35,1:2.2]` 中间慢放、`v=[0:0.35,0.45:2.6,0.75:2.6,1:0.35]` 子弹时间。

### 2.7 场景 / 背景（`scene=…`）
背景属于关键帧，逗号分隔，**只在变化时写**，第一帧写一次全局背景：
```
scene=bg=gradient,color=#0b0f16,grad=#1d2534>#05070b,angle=160,env=1,exp=1,shadow=0.55:2.6
```
字段：`bg=solid|gradient|none|media`、`color`、`grad=#from>#to`、`angle`、`env`、`exp`、`shadow=<透明度>:<模糊>`、`bgmedia=<别名>`、`bgfit=cover|contain`、`bgoverlay`、`bgblur`。

---

## 3. 语义（写对动作的关键）

1. **运动插值**：`p/a/sc/s` 两帧间线性插值，进度由该段**变速曲线**塑造——`v=1` 匀速，斜坡即缓动。**变速曲线同时就是缓动曲线**。
2. **贴图 / 场景 / 显隐是"跳变"**：在到达帧瞬间切换，不交叉淡入。
3. **渐隐/渐显**：起始帧 `hid` + 结束帧 `vis=fade` = 淡入；结束帧 `hid=fade` = 淡出。**设备屏幕会跟着一起淡**（无需额外处理）。
4. **开合角 `s`**：仅带铰链设备可用（0=合上，越大越开）；手机写 `-`。
5. **默认屏幕是空白**：不写 `f=` 就是深色空屏，不会出现出厂壁纸。

---

## 4. 可调用资源

### 4.1 设备（`model:<id>`）

| 资产 id | 名称 | 开合 `s` | 贴屏 `f` | 屏幕比例(宽/高) | 形态 |
|---|---|---|---|---|---|
| `macbook-pro-13-2020` | MacBook Pro 13" | 0..135（默认开 120）| 是 | 1.595 | 笔记本 |
| `iphone-16-pro-max` | iPhone 16 Pro Max | 否（`-`）| 是 | 0.47 竖屏 | 手机 |
| `xiaomi-17-pro-max` | 小米 17 Pro Max | 否（`-`）| 是 | 0.456 竖屏 | 手机 |
| `gaming-laptop` | 游戏本 | 0..180（180=摊平）| 是 | 2.17 | 笔记本 |

### 4.2 字体（`text font=<id>`）

- 内置 id：`wenkai`（霞鹜文楷，默认，中英）、`dejavu`、`dejavu-bold`。
- 其余内置/系统字体用**文件名**作 id，常用内置：
  - 阿里巴巴普惠体 `Alibaba_PuHuiTi_2.0_55_Regular_55_Regular.ttf`（字重后缀 `35_Thin`/`45_Light`/`65_Medium`/`75_SemiBold`/`85_Bold`/`95_ExtraBold`/`105_Heavy`/`115_Black`）
  - 思源黑体 `Source_Han_Sans_SC_Regular.otf`（另有 `Light`/`Medium`/`Bold`/`Heavy`/`ExtraLight`/`Normal`）
  - 思源宋体 `Source_Han_Serif_SC_Light_Light.otf`
  - 阿里妈妈：`AlimamaDongFangDaKai-Regular.ttf`（东方大楷）、`AlimamaShuHeiTi-Bold.ttf`（数黑体）、`AlimamaFangYuanTiVF-Thin.ttf`（方圆体）、`AlimamaAgileVF-Thin.ttf`（灵动体）
  - 钉钉进步体 `DingTalk-JinBuTi.ttf`、得意黑 `SmileySans-Oblique-2.ttf`、庞门正道 `PangMenZhengDaoBiaoTiTiMianFeiBan-2.ttf`、站酷高端黑 `GaoDuanHeiXiuDing151105-1.ttf`、站酷酷黑 `ZhanKuKuHei-1.ttf`、Nabla `Nabla_Regular.ttf`
- 系统字体也自动可用（按文件名）；引用不存在的字体时回退到 `wenkai`。

### 4.3 其它
- 画幅：`16:9` / `9:16` / `1:1` / `4:5` / `21:9`。
- 轨道色：`#f5a524` `#4c8dff` `#2bb673` `#e879f9` `#22d3ee` `#fb7185` `#a3e635` `#f97316`。
- 屏幕贴图模式：**平铺 tile / 裁剪 cover / 填充 fill**（另 `contain` 仅兼容保留，不在 UI）。
- 默认背景：`bg=gradient,color=#0b0f16,grad=#1d2534>#05070b,angle=160,env=1,exp=1,shadow=0.55:2.6`。

---

## 5. 完整示例

### 5.1 手机升起并旋转（运动 = 两帧）
```
# 简辑 · 工程文件 v1

project = 手机展示
aspect = 9:16
fps = 30

phone = model:iphone-16-pro-max

@phone t=0.0 p=[0,0,0] s=- a=[0,0,0] f=- v=1 scene=bg=solid,color=#101418,env=1,exp=1
@phone t=2.0 p=[0,1.2,0] s=- a=[0,360,0] f=- v=[0:0.4,1:1.8]
```

### 5.2 MacBook 打开 + 屏幕播视频
```
# 简辑 · 工程文件 v1

project = 宣传片
aspect = 16:9
fps = 30

intro = media:素材/intro.mp4
mac = model:macbook-pro-13-2020

@mac t=0.0 p=[0,0,0] s=0 a=[0,-20,0] f=- v=1 hid scene=bg=gradient,color=#0b0f16,grad=#1d2534>#05070b,angle=160,env=1,exp=1,shadow=0.55:2.6
@mac t=0.8 p=[0,0,0] s=120 a=[0,-20,0] f=- v=[0:0.8,1:1] vis=fade
@mac t=1.2 p=[0,0,0] s=120 a=[0,-20,0] f=intro v=1
@mac.clip c1 m=intro t=1.2 in=0 out=2.8 v=1
```

### 5.3 文字标题淡入
```
# 简辑 · 工程文件 v1

project = 标题
aspect = 16:9
fps = 30

title = text "标题"
  text font=wenkai size=0.6 color=#ffffff align=center content="你好，简辑"

@title t=0.0 p=[0,0.8,0] s=- a=[0,0,0] f=- v=1 hid scene=bg=none,env=1,exp=1
@title t=0.6 p=[0,0.8,0] s=- a=[0,0,0] f=- v=1 vis=fade
```

---

## 6. 自检清单（生成后逐项核对）

- [ ] 第一行是 `# 简辑 · 工程文件 v1`。
- [ ] 每个 `@别名` 都能找到对应声明；无 `@camera`。
- [ ] 手机 `s=-`；笔记本 `s=<0..上限>`。
- [ ] `f=` 引用已声明的素材别名，无贴图写 `-`。
- [ ] 每个对象**至少两个关键帧**（否则视频时长 = 0）。
- [ ] `scene=` 用逗号分隔，全局背景在第一帧写过。
- [ ] 含空格的名字/路径加了双引号；值内无空格；列表用 `[a,b,c]`。
