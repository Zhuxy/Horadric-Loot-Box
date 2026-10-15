# D2R Item Corpus（新 .d2i 格式验证库）

从 GGM's Item Pack 的 D2R 文件中提取的干净物品库，用于 Horadric-Loot-Box 导入/导出能力的验证。

## 来源

- `SharedStashSoftCoreV2.d2i`（v98）、`SharedStashHardCoreV2.d2i`（v97）：D2R 共享仓库
- `D2R Char Files/` 下 120 个 D2R 人物档（v97/v98/v99）
- **已排除**：24 个 v96 人物档（1.13 格式，不可信）、全部 4422 个 1.13 版 `.d2i` 单文件

## .d2i 文件格式（新结构）

每个 `.d2i` = `itemBytes(item)` 的原始输出，即 D2R 物品 bit 流（byte-aligned），**不含 `JM` 头**。
导入时用 `parseItemBytes(bytes, saveVersion)` 解析，`saveVersion` 见 `MANIFEST.json` 中每条记录。

- 带孔物品：socketed 子物品的 bytes 直接拼接在后面（`itemBytes` 已处理），单个 `.d2i` 即完整物品。
- 位置信息（mode/x/y/page）保留原始值；导入时由应用负责重新放置（`withPlacement`）。

## 分类

按 `Quality` 枚举分目录：`unique/`、`set/`、`rare/`、`magic/`、`normal/`、`superior/`、`crafted/`、`inferior/`。
文件名格式：`序号_物品代码_物品名.d2i`（序号保证唯一，物品名已做文件名安全处理）。

## 验证状态

- 1126 个物品全部通过 `parseItemBytes → itemBytes` round-trip（字节完全一致，fingerprint 一致）。
- 解析失败的物品（作弊/损坏数据，见 `FAILURES.json`）已隔离，未入库：
  - 常见原因：`Unknown stat id`（bit 流中的非法 stat）、`has no save bits`（物品上出现了角色专有 stat，
    如 nextexp，系 Hero Editor 改出的非法物品）。解析器拒收这些是正确的行为。

## 文件

- `MANIFEST.json`：每条记录含 `file`、`source`（来源文件#分组#index）、`saveVersion`、`code`、`quality`、
  `name`、`fingerprint`、`ethereal`、`socketed`、`runeword`、`bytes`。
- `FAILURES.json`：解析失败/跳过的来源记录（含原因）。
