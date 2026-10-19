# Horadric Loot Box · 移动端 UI SPEC v1.0

> 状态：草稿（与 HTML 原型 `mobile/prototype/index.html` 联调迭代中）
> 日期：2026-10-19 · 配套原型：https://lab.ianonai.work/tech/hlb-mobile-ui/

## 1. 背景与目标

- 同 repo 双入口、core 共享（架构已定，`mobile-entry` 分支）：`src/core`（存档解析/物品/导入导出/宝库）与 `src/state/store.ts` 零改动复用；移动端只做新的前端入口 `mobile/`。
- 产品定位：**随身仓库管理**。iOS 上没有 D2R 本体，App 不负责"玩"，负责随时随地看装备、整理宝库、导入导出。
- 本 SPEC 只覆盖 UI/交互；iOS bring-up（Rust stub、签名、`make ios`）另行推进。

## 2. 平台约束（iOS，不可违反）

| 约束 | 做法 |
|---|---|
| 沙盒：不能写 D2R Mobile 容器 | 存档"考进考出"：App 自己的 Documents 为工作区（`UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`），经文件 App 中转 |
| 导出到沙盒外 | 只能走**系统分享**：由用户亲手在 picker 里选位置，拿到一次性 security-scoped URL 再写。App 内"导出"按钮合法的原因就是这个 |
| 无意义的桌面命令 | `is_game_running`（sysinfo 沙盒内恒 false）→ stub；`reveal_backups`（spawn `open`）→ iOS 禁止；`art_detect_installs`（扫 drive_c）→ stub，改走"用户亲手拷资源包" |
| updater | 桌面独占插件，iOS 上隐藏一切更新 UI |
| D2R Mobile 的存档布局 | 文件夹嵌套（`David/David.d2s`），`save_files` 已支持扫描一层子目录 |

## 3. 设计原则

1. **单列、一次一屏**：桌面是左右双 pane，手机上改为底部 Tab（角色/仓库/宝库/同步）一次只看一屏。
2. **点选 + 底部 Sheet 代替一切桌面手势**：拖拽、右键、双击在触屏上不存在。点物品 → 底部弹出操作 Sheet（放入宝库 / 移动到… / 导出为 .d2i / 删除）。
3. **触控目标 ≥44pt**，单手可达。
4. **复用组件、重做构图**：`Grid` / `ItemTile` 等组件复用，页面构图重写，不重写组件。
5. **质感与桌面端一致**（见 §4），不能是"另一个 App 的感觉"。

## 4. 视觉系统（取自桌面版源码配方，不得自创）

源：`src/index.css`、`tailwind.config.js`。原型已按此换肤并截图验证。

- **石材面板**：SVG 噪点（`feTurbulence`）+ `linear-gradient(180deg,#222225 0%,#18181a 100%)`
- **哥特描边**：`inset 0 0 0 1px #6b6b70, inset 0 0 0 3px #1b1b1d, inset 0 0 0 4px #46464a, inset 0 0 22px rgba(0,0,0,.55)`（移动端卡片可用简化版）
- **物品格**：暗靛蓝 `#17123f`；空格子/网格底 `#060607` + 内嵌石 rim
- **圆角**：桌面为 0；移动端统一 **2px**（锐角，触屏友好下限）
- **金色**：按钮渐变 `#d4b66a→#9c7a34`；标题 Cinzel（Google Fonts，离线回退 Georgia）+ 雕刻阴影 `0 1px 0 #000, 0 0 6px rgba(0,0,0,.8)`
- **品质色**：unique `#c7b377` / set `#1fdc1f` / magic `#6969ff` / rare `#ffff64` / rune `#ffa033`（边框与文字统一用此套）
- **墨色阶**：`#0b0a09 #121110 #181614 #1f1c19 #2a2622`（文字 `#d8cdbf #b3a697 #8a7d70`）

## 5. 页面清单

### 5.1 角色（Tab 1）
- 角色卡片列表：头像（靛蓝格）、名 / 等级职业 / 金币·储物箱金额；共享仓库卡片；宝库卡片。
- 点卡片 → 角色详情。

### 5.2 角色详情
- 顶部三段切换（选中为金色填充）：**装备 / 背包 / 佣兵**。
- **装备**：纵向 slot 列表（头盔/项链/武器/护甲/副手/腰带/手套/靴子…），每行 = 靛蓝图标 + 名 + 类型副标题。桌面是纸娃娃，手机上纵向列表信息等价、触控友好。
  - 佣兵段：同样三段切换（头盔/护甲/武器），雇佣兵存在时显示（桌面逻辑：`(ch.mercSplit \|\| ch.mercItems.length > 0)`）。
- **背包**：10×4 网格（桌面同款暗靛蓝格），点格 → 物品 Sheet。下方金币条。
- 右上角"⤵ 导入"按钮（见 §6）。
- 点任意物品 → **物品 Sheet**：标题（品质色）、属性预览、操作：放入宝库（主按钮）/ 移动到… / **导出为 .d2i** / 删除（红字）。

### 5.3 仓库（Tab 2）
- Tab I–VII 横滑 chips；网格；底部金币条；顶部"⤵ 从文件导入 .d2i"按钮。
- 对应桌面"每面板独立导入按钮"。

### 5.4 宝库（Tab 3）
- 顶部"⤵ 从文件导入 .d2i"按钮；搜索框；分类 chips（全部/暗金/套装/亮金/蓝色/珠宝/护身符/符文/底材…）**带真实过滤**（原型已实现，含空状态）。
- **列表行**（图标 + 名 + 类型）：vault 数据模型就是 `entries: VaultEntry[]`（`{uid,item,addedAt,source}`，无坐标），列表展示是忠实于数据模型的，桌面版大黑板只是用格子隐喻包装了同一个列表。

### 5.5 同步（Tab 4）
- 存档来源说明（文件 App → App Documents，"考进"）；**导出**按钮（系统分享选位置）；游戏运行中警告（与桌面一致：游戏运行时不写存档）。

## 6. 导入 / 导出流程

### 6.1 导入（三处入口：宝库页 / 仓库页 / 角色详情页）
1. 点"导入" → 系统文件选择器选 `.d2i`（iOS 上为 document picker）。
2. **导入 Sheet**：物品预览（名/品质/类型）+ 数量步进（可堆叠物品）+ **目标三选一**（宝库 / David 背包 / 共享仓库；**默认目标跟随入口面板**，如从仓库页进则默认"共享仓库"）+ fit 提示。
3. fit 提示文案：宝库 → "无限，直接追加，无需找格子"；背包/仓库 → "按物品面积自动找位，放不下会提示"（对应 `First-Fit-Decreasing + findSpot`）。
4. 确认导入 → Toast。
- 解析用 `core.parseImportFile`（round-trip 校验 + `planImport`），原型中预览为 mock，真实实现 UI 不变。

### 6.2 导出（物品 Sheet → 导出为 .d2i）
1. **导出 Sheet**：说明"iOS 上导出会打开系统分享，由你亲手选择保存位置（如 D2R Mobile 文件夹），App 不会背地里写别处"。
2. "选择保存位置…" → 系统分享 → 完成 Toast。
- 导出字节流走现有 `export .d2i` 逻辑。

## 7. 数据模型要点（UI 必须尊重）

- **vault 无坐标**：`Vault.entries` 是数组；格子只存在于游戏存档侧（背包/储物箱）。物品离开 vault 进入角色/仓库的瞬间才由放置算法定格。
- **佣兵装备**：上游已支持（`d2s.ts` 解析 merc 区段，`core/merc.ts` 规则，`Equipment.tsx` 的 `MercPanel`）；移动端沿用同一显示条件。
- **金币**：vault 金币按 `goldPot`（版本×软硬核）分池，不跨池。

## 8. 美术资源（物品图标）

- 目标：游戏内 HD sprite（`hd/global/ui/items/*.sprite`，SpA1），**必须来自用户自己购买的游戏文件**（CascView 解包），自用侧载，绝不进分发包。
- 移动端实现：新增 `ArtBackend`（读 App Documents 下的资源包，`decodeSprite` 纯 TS，webview 内解码）；`art_detect_installs` 在 iOS 上 stub。
- 无资源时降级 glyph 图标（`demo` 模式已有），UI 不变。
- 原型中 emoji 仅为占位。

## 9. 未决 / 后续

1. 装备页"纵向列表 vs 纸娃娃"信息是否足够（等用户上手反馈）。
2. 背包格子触控尺寸实测（iPhone 15 Pro）。
3. 真实 `.d2i` 解析接入（`core.parseImportFile`）与 fit 实时计算。
4. iOS bring-up：`tauri ios init` → Rust stub（must-fix 3）→ `build.rs` 的 `TARGET_OS_MAC` 门限放宽到 Apple 全平台（must-fix 2）→ `make ios`（must-fix 1：Documents 工作区 + `detect_save_folders` 扫沙盒）。
5. 桌面端 `make desktop` 打包在 M2 上验证（与本 SPEC 无关，另行）。

## 10. 原型

- 源码：`mobile/prototype/index.html`（单文件，离线可开；含桌面框展示壳 + 手机屏）
- 在线：https://lab.ianonai.work/tech/hlb-mobile-ui/
- 原型交互均为真实 JS（Tab 切换、Sheet、宝库过滤、导入/导出 Sheet），物品数据与解析预览为 mock。
