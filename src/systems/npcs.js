// NPC 与世界观数据：空间站人员对话 + 坠机点数据日志（纯数据，可测试）

// 空间站人员（站台管理官 / 交易官 / 船坞技师）
export const STATION_NPCS = [
  {
    id: 'kaela', name: '站长 · 卡伊拉', role: '轨道站管理官', color: '#7ff0ff',
    lines: [
      '欢迎来到地球轨道空间站。这里是太阳系文明最后的灯火。',
      '四十年前，"无人深空计划"派出殖民舰队航向群星，此后音讯全无。我们是留守者。',
      '最近，深空天线收到一段规律脉冲信号——来自比邻星方向。也许他们成功了，也许不是。',
      '你的飞船已被登记。修好它，或许你能替我们走一趟比邻星，找到答案。',
    ],
  },
  {
    id: 'vero', name: '商人 · 维罗', role: '交易官', color: '#ffb84d',
    lines: [
      '空间站通用货币是信用点。矿石、晶体、燃料，什么都收。',
      '收购订单比散卖划算得多，先看任务中心再出手。',
      '金星的金矿最值钱——如果你受得了那里的剧毒大气。',
      '火星的铁氧体、冰巨星上的二氢晶体，都是抢手货。',
    ],
  },
  {
    id: 'tessa', name: '工程师 · 泰莎', role: '船坞技师', color: '#8fdcb0',
    lines: [
      '船坞升级永久生效：引擎提速，护盾扩容。信用点管够就行。',
      '想去更远的星系？先把引擎升满。不过说实话，这艘小船撑不到比邻星。',
      '船坞深处封存着一艘大型殖民船的蓝图。也许有一天能造出来。',
    ],
  },
];

// 坠机点数据日志（世界观文本收集品；id 用于存档）
export const CRASH_LOGS = [
  {
    id: 'log1',
    title: '航行日志 #1 · 坠毁前',
    text: '【航行日志 #1】 太阳风强度超预期，主引擎熄火。我们正在坠向一颗蓝色行星。\n若有人读到这段记录：优先回收多功能工具蓝图与金属镀层，先活下去。',
  },
  {
    id: 'log2',
    title: '航行日志 #2 · 船长指令',
    text: '【航行日志 #2 · 船长指令】 船员们：飞船结构大致完好，脉冲引擎、座舱玻璃与发射推进器受损。\n收集铁氧体与二氢，修复飞船，回到轨道站。地球轨道空间站会接应我们。',
  },
  {
    id: 'log3',
    title: '求救信标记录',
    text: '【求救信标】 自动信标已开启，向地球轨道空间站持续发送求救信号。\n若三天内无人回应，信标将切换到比邻星中继频道——虽然那个频道从未有人应答过。',
  },
];

export function logById(id) {
  return CRASH_LOGS.find((l) => l.id === id) || null;
}
export function npcById(id) {
  return STATION_NPCS.find((n) => n.id === id) || null;
}

// 状态感知对话：NPC 台词随游戏进度追加（基础台词 + 达成条件后的后续台词）。
// 此前台词永远停在开局——买完大船回到空间站，泰莎还在说"蓝图封存中"（对话过期）。
// state: { bigship, reachedProxima, engine, shield }
export function getNpcLines(npc, state = {}) {
  const st = state || {};
  const lines = [...npc.lines];
  if (npc.id === 'kaela') {
    if (st.reachedProxima) {
      lines.push('你回来了——比邻星的回音，比我们四十年的等待更珍贵。');
    } else if (st.bigship) {
      lines.push('曙光号已经出坞。带上这份星图——别让他们的信号成为绝响。');
    }
  } else if (npc.id === 'vero') {
    if (st.reachedProxima) {
      lines.push('比邻星的样品……全新的市场！这批货我全要了，价钱好说。');
    } else if (st.bigship) {
      lines.push('听说你提了曙光号？跨星系运货——我出运费，你出胆量。');
    }
  } else if (npc.id === 'tessa') {
    if (st.bigship) {
      lines.push('曙光号交给你了。她比站里任何船都结实——别在跃迁门那头迷了路。');
    } else if ((st.engine || 0) >= 2) {
      lines.push('引擎已经升满。下一步……也许你该去船坞深处看看。');
    }
  }
  return lines;
}
