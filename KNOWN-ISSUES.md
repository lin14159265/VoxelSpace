# KNOWN-ISSUES · 严格 Review 修复清单

> 生成日期：2026-08-16
> Review 区间：`e466e59`（第 32–43 轮基线）→ `98a9b3b`（第 44–52 轮）
> Review 基线：`npm test` 44664 通过，0 失败；游戏无头浏览器回归 38/38 绿。
> 状态说明：本文 P0–P3 问题已于**第 53 轮按顺序全部修复**；单测由 44664 增至 44677，相关浏览器回归与主线通关均绿。以下保留原始根因、证据与修复落点。

## 严重度定义

- **P0**：玩家会直接看到/感受到的错误，或世界生成错误，必须优先修复。
- **P1**：规则或文案与实际行为不一致，可能造成奖励丢失或系统语义失效。
- **P2**：设计平衡或代码健壮性问题，当前不一定崩溃，但需要排期修复。
- **P3**：反馈不准确、仓库卫生或测试缺口。

---

## 修复清单

### [P0-1] 水体生成顺序错误：植物/树木会覆盖湖水
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/world/chunk.js`
- **现象**：草地行星低洼湖泊中会生成钠花、氧草、二氢、树木；树干/树叶直接替换水方块，湖面被植被刺穿。
- **证据**：对 `water-seed` 扫描 205 个含湖区块、73,340 个应为水方块：
  - 被覆盖：**4,655 个（6.3%）**
  - 分布：树叶 3026、原木 131、二氢 292、钠 511、氧 464、碳 231
- **根因**：水在 `chunk.generate()` 阶段 1b 填充；阶段 4 植物、阶段 5 树木随后把方块写回水面。
- **推荐修复**：
  1. 植物/树木生成前判断该列 `heightAt(x,z) < waterLevel` 则跳过；或
  2. 把水体填充移到植物/树木/地标阶段之后，由水覆盖所有植被。
- **应补回归**：对所有含湖区块断言 `h+1..waterLevel` 全部为 `B.WATER`。
- **修复与证据**：植物/树木阶段统一以 `grassWaterLevel` 跳过水下湖列；`tests/run.js` 新增水体列完整性断言，`tools/verifywater.mjs` 新增同一约束并全绿。

### [P1-2] 里程碑奖励“暂缓”不补发，奖励会永久丢失
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/systems/milestones.js`
- **现象**：信用点满 999 且背包无空位时，`grantReward()` 提示“背包已满，奖励暂缓”，但没有 pending 队列，也没有任何后续补发。
- **推荐修复**：增加 `pendingRewards` 并写入存档，在背包可接收时自动补发；或先改文案为“奖励未能发放”，避免误导。
- **应补回归**：满信用点状态下触发带奖励里程碑，清空空间后验证奖励是否补发/或文案与行为一致。
- **修复与证据**：新增 `Milestones.pending` 队列 + `flushPendingRewards()`，由 `Game.loop()` 自动补发并随存档往返；`tests/run.js` 与 `tools/verifymilestones.mjs` 补发场景全绿。

### [P1-3] 猎杀悬赏会把“白天自燃死亡”计入进度
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/entities/mobs.js`、`src/systems/missions.js`
- **现象**：任务文案要求“夜间消灭 3 只夜行兽”，但 `Mob.die(burn)` 无差别调用 `onMissionEvent('kill')`，白天怪物自燃死亡也 +1。
- **推荐修复**：
  - 方案 A：`if (!burn) g.onMissionEvent('kill', { mob: this.kindId });`
  - 方案 B：将任务文案改为“消灭 3 只夜行兽（白昼燃烧也计入）”。
- **应补回归**：分别验证 `burn=true` 与 `burn=false` 两种死亡路径的任务推进。
- **修复与证据**：采用方案 A，并在 `missionEvent()` 增加 burn 防御；`tests/run.js` 纯逻辑断言 + `tools/verifymissionboard.mjs` 真实 Mob 死亡路径均通过。

### [P2-4] 基地休息无成本反复跳过夜晚
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/core/game.js`（`restAtBase()`）
- **现象**：只要 `nightFactor > 0.5`，靠近基地终端按 E 即可切到 06:00，并满血/满盾/满生命维持/满危险防护；无冷却、无材料、无次数限制。
- **影响**：夜晚生物、夜寒危险与“回基地避险”的张力被压缩为“按 E 跳过夜晚”。
- **推荐修复**：增加休息冷却（如 240 秒）、材料消耗或恢复比例限制（如只恢复到 70%）。
- **应补回归**：连续休息行为、冷却状态与存档恢复。
- **修复与证据**：采用 240 秒冷却（`BASE_REST_COOLDOWN`），冷却随存档保存；`tools/verifybase.mjs` 验证连续休息被阻止、清零后可再休息、读档恢复。

### [P2-5] 太空战斗“紧急返航”时的数组突变脆弱点
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/space/spacecombat.js`
- **现象**：海盗弹循环内 `takeShipDamage()` 若触发船体归零，会调用 `emergencyLand()` → `clear()`，把 `this.enemyBolts` 替换为新数组；外层循环随后仍按旧索引操作新数组。
- **当前影响**：尚未造成崩溃，但依赖“新数组 splice 大索引无副作用”的偶然行为。
- **推荐修复**：`takeShipDamage` 返回是否紧急返航；触发时 `SpaceCombat.update()` 立即 `return`。
- **应补回归**：在敌弹命中导致船体归零的路径上验证无残留实体/无页面错误。
- **修复与证据**：微陨石与海盗弹两处伤害都检查 `takeShipDamage()` 返回值并立即 `return`；`tools/verifyspacecombat.mjs` 新增敌弹致死路径断言数组全空、无页面错误。

### [P2-6] 创造模式可推进任务板悬赏
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/core/game.js`（`onMissionEvent()`）、`src/systems/missions.js`
- **现象**：创造模式下可瞬间挖 40 格、秒杀生物完成悬赏并换取信用点。
- **推荐修复**：任务板在创造模式禁用，或在 `onMissionEvent` 入口对 `game.creative` 直接 return。
- **应补回归**：创造模式下采矿/击杀/访问不推进悬赏。
- **修复与证据**：采用任务板禁用方案：接单/交付/自动进度在创造模式全部拦截，UI 显示不可用；`tools/verifymissionboard.mjs` 新增创造模式步骤全绿。

### [P3-7] 海盗赏金在背包满时会显示“+0 信用点”
- **状态：✅ 已修复（第 53 轮）**
- **涉及文件**：`src/space/spacecombat.js`（`destroyPirate()`）
- **现象**：信用点无法入账时 `added=0`，但 toast 仍为“赏金 +0 信用点”。
- **推荐修复**：区分“击毁奖励已入账”与“背包已满，赏金无法接收”。
- **应补回归**：满信用点背包状态下击毁海盗的反馈正确性。
- **修复与证据**：`destroyPirate()` 先 `canAdd` 再入账，满包时显示“背包已满，赏金无法接收”；`tools/verifyspacecombat.mjs` 新增满包击毁断言。

### [P3-8] 仓库卫生：未跟踪的“自然选择号”草稿文件
- **状态：✅ 已修复（第 53 轮）**
- **现象**：`models/`、`natural-selection.html`、`natural-selection-preview.bundle.js`、`src/entities/naturalSelection.js` 及多个 `tools/*natural-selection*` 文件未纳入版本控制。
- **影响**：
  - `git clone` 交付不包含这些文件；
  - `ls tools/verify*.mjs` 显示 39 个，而游戏回归套件口径为 38 个；
  - 文档、工具计数与工作区实际内容存在漂移风险。
- **推荐处理**：确认该模型草稿归属后，入库或删除；在 README/PROGRESS 中明确“游戏 verify 套件”与“外部模型校验”的口径差异。
- **修复与证据**：已确认归属并全部入库（`models/`、预览页/包、`src/entities/naturalSelection.js` 及 4 个 tools 脚本）；文档口径统一为“38 套游戏回归 + 1 套自然选择号模型校验”；`tools/verify-natural-selection.mjs` 全绿。

---

## 测试体系（第 53 轮已补齐）

1. ✅ 水体与植被/树木的生成顺序约束（`tests/run.js` + `tools/verifywater.mjs`）。
2. ✅ 里程碑奖励在满信用点下的结算与补发（`tests/run.js` + `tools/verifymilestones.mjs`）。
3. ✅ 白昼燃烧死亡与任务板击杀进度的隔离（`tests/run.js` + `tools/verifymissionboard.mjs`）。
4. ✅ 基地休息冷却的连续行为与存档往返（`tests/run.js` + `tools/verifybase.mjs`）。
5. ✅ 紧急返航后太空战斗实体与弹丸的完全清理（`tools/verifyspacecombat.mjs`）。
6. ✅ 创造模式与任务板进度隔离（`tools/verifymissionboard.mjs`）。

---

## 修复顺序记录

1. ✅ **P0-1**：水体生成顺序已修复，湖列完整性回归补齐。
2. ✅ **P1-2 / P1-3**：奖励补发队列与燃烧死亡任务隔离已修复。
3. ✅ **P2-4 / P2-5 / P2-6**：基地休息冷却、太空战斗数组安全、创造模式任务板禁用已修复。
4. ✅ **P3**：海盗赏金文案与自然选择号仓库卫生已收尾。
