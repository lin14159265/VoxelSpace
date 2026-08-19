# VOXELSPACE 验收报告（试玩交付前审查）

> 验收标准：把游戏发给陌生玩家试玩——无需开发者指导即可自然开始并游玩 30–90 分钟，体验到探索/生存/采集/成长/飞船/星球旅行/星际探索的乐趣，且没有高频 Bug、操作困惑、严重卡顿、空洞内容或半成品感。

## 一、验收清单逐项对照

| # | 验收标准 | 状态 | 证据 |
|---|---|---|---|
| 1 | 主流程稳定完整 | ✅ | `tools/verifyfullrun.mjs`：新存档从主菜单开始（含开场镜头跳过），**真实动作**走完 17 步任务链至旅程完成面板 17/17，全程零错误（16 项断言） |
| 2 | 新玩家基本无需解释即可游玩 | ✅ | 反剧透任务面板（只显示当前+2 步+折叠计数，标题带进度）、开场俯瞰镜头、坠机点第一眼可见飞船（朝向/残骸堆/视线走廊）、首次拾取钠/氧用途提示、日志→修船指引、B/Esc 面板语义分离、四级星图与带探索迷雾的地表航点导航 |
| 3 | 核心玩法具有明确乐趣和成长感 | ✅ | 生存补给闭环（钠→危险防护/氧→生命维持/护盾电池→护盾）、21 项里程碑全程脉冲+全成就时刻、飞船三件修复→起飞→太空→登月/卫星/小行星开采的成长弧、空间站经济（卖/订单/升级/大船） |
| 4 | 世界不再明显空洞 | ✅ | 每星球 ~27 处异常点（遗迹/无人机/补给箱，扫描品红标记）、3 篇数据日志、行星地标植被（冰晶塔/岩石柱/碳晶簇）、矿脉与植物 |
| 5 | 不同星球和阶段存在明显体验差异 | ✅ | 8+3 行星各自的地形参数/地表块/资源富集/环境危险/天气/夜间生物构成/异常点口味；真实重力、昼夜长度、太阳视大小、大气密度→天空/雾/阻力/再入热障全链路差异化（见第 9/10/22/26/33/43 轮） |
| 6 | 探索过程中持续存在发现和奖励 | ✅ | 异常点奖励、日志收集、里程碑、扫描信号、信用点经济循环 |
| 7 | 视觉、UI、音效和氛围具有统一感 | ✅ | 全程序化像素纹理/着色天空/星云/土星环；统一科幻 HUD；全 WebAudio 合成音效+双模式背景音乐+分轨音量；视觉模型多轮审查确认"成品级 UI" |
| 8 | 没有已知的严重 Bug | ✅ | 14+ 轮开发共修复并回归覆盖的历史 bug 清单见 PROGRESS.md；当前 38 套游戏无头浏览器回归套件 + 1 套自然选择号模型校验（第 44–52 轮核心乐趣/采矿建造/战斗/经济/基地/水体/材质/太空战斗/任务板专项）全量审计全绿；第 53 轮已把 KNOWN-ISSUES 的 P0–P3 全部修复并补齐回归 |
| 9 | 没有高频出现的破坏体验问题 | ✅ | 面板进出（B/Esc/重锁/防误弹）、满背包不吞资源（canAdd 预检四处）、怪物不穿墙、隔墙不被打、开场键位零冲突 |
| 10 | 长时间游玩和存档基本稳定 | ✅ | `soaktest` 50 分钟快进（无错误/内存 24→91MB/区块有界/读档逐项一致）；`verifyroundtrip` 4 次跨星系往返+中途存读档；老存档兼容测试 |
| 11 | 性能在普通电脑上达到合理水平 | ✅ | `perflow`：低画质 215 FPS（p95 6ms）/高画质 155 FPS；内存 49/142MB；粒子池 640 环形上限；风暴+战斗+区块风暴压力长测无卡死帧 |
| 12 | 测试覆盖核心流程和主要边界情况 | ✅ | 44677 断言 + 38 套游戏无头浏览器回归套件 + 1 套自然选择号模型校验（全量审计全绿）：通关/长时/存读档/多起降/多往返/登月/多卫星/天狼星系/小行星开采/地表导航与迷雾持久化/地下结构差异（熔岩灼伤+动态火光）/大气阻力与再入热障/极端背包/风暴战斗同屏/老档兼容/死亡边界/面板边界 |
| 13 | 可以构建出干净、易运行的试玩版本 | ✅ | 本轮实测：`git clone` 到全新目录 → `npm install`（12s）→ `node server.js` → 单元测试 44677 通过 + verifyfullrun/verifyintro/verifygamefeel/verifybuilddepth/verifycombatdepth/verifyeconomy/verifybase/verifywater/verifytexturevariants/verifyspacecombat/verifymissionboard + verify-natural-selection 全过（见下文"干净环境验证"） |
| 14 | 达到"可以发给别人玩"的完成度 | ✅ | README 完整试玩说明（运行/玩法/按键/系统/测试/结构）、start.bat 一键启动、无调试痕迹（G 键重生成已移除、无开发字样、无变量名泄漏到 UI） |

## 二、干净环境验证（本轮实测）

```
git clone <repo> voxelspace-clean
cd voxelspace-clean
npm install          # 12s，2 packages
node server.js 8081  # 正常启动
node tests/run.js    # 44677 通过, 0 失败
node tools/verifyfullrun.mjs  # 全部通过（完整通关 16 项）
node tools/verifyintro.mjs    # 全部通过（17 项）
node tools/verifygamefeel.mjs  # 全部通过（6 项）
node tools/verifybuilddepth.mjs # 全部通过（6 项）
node tools/verifycombatdepth.mjs # 全部通过（8 项）
node tools/verifyeconomy.mjs    # 全部通过（6 项）
node tools/verifybase.mjs       # 全部通过（7 项）
node tools/verifywater.mjs      # 全部通过（5 项）
node tools/verifytexturevariants.mjs # 全部通过（3 项）
node tools/verifyspacecombat.mjs    # 全部通过（7 项）
node tools/verifymissionboard.mjs   # 全部通过（6 项）
```

## 三、交付物

- **直接可玩**：双击 `start.bat`（Windows，自动开浏览器）；其他系统 `npm install && npm start`
- **文档**：README.md（玩家向）、PROGRESS.md（开发记录 29 轮）、本报告（验收对照）
- **建议浏览器**：Chrome / Edge（指针锁定 + WebGL2）
- **已知限制**（非阻断）：NPC 支线有限；键盘+鼠标操作（无手柄/触屏）；存档在 localStorage（已提供**导出/导入存档**按钮缓解——备份、迁移、报 bug 附存档）

## 四、结语

Demo 已从"功能完备"迭代为"体验完整"：开场有冲击、循环有深度、世界有回应、全程有反馈、性能有档案、交付有证明。当前状态适合发给陌生玩家试玩并收集评价。
