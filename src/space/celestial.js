// 统一宇宙数据模型（纯数据 + 纯逻辑，可在 Node 中测试）
//
// 层级：恒星级星图 → 恒星系统（太阳系）地图 → 行星系统地图 → 行星地表
// 所有重要天体（恒星 / 行星 / 卫星 / 小行星带 / 空间站 / 跃迁门）使用同一套
// 记录结构，未来新增轨道设施、工业设施、望远镜等只需追加数据，不需要新硬编码。
//
// 尺度约定（“底层物理尺度”与“地图视觉尺度”分离）：
//   - AU              = 1000 旅程单位：世界旅程坐标中 1 AU 的长度，
//                       太阳系行星之间的相对距离严格按真实比例（如木星 ≈ 5.2 AU）。
//   - aAU / radiusKm  = 真实天文数据，用于信息面板、星图轨道与比例换算。
//   - visualRadius    = 太空球体视觉半径（按真实半径立方根压缩），保证可读性。
//   - 卫星轨道在世界旅程坐标中按母行星视觉半径放大（否则会被行星球体吞没），
//     星图与信息面板中仍显示真实半长轴。

import { hashSeed } from '../world/noise.js';

export const AU = 1000;                       // 1 天文单位 = 1000 旅程单位
export const AU_KM = 149597870.7;             // 1 AU 的真实公里数
export const KM_PER_UNIT = AU_KM / AU;        // 旅程单位 → 公里
export const LIGHT_YEAR_KM = 9.4607e12;

// ---- 太阳系行星配置（继承旧关卡数据，补齐真实轨道与天体参数） ----
// id / navId 稳定：旧存档里的数字星球 id（0..7）仍按本表顺序映射。
export const SOLAR_SYSTEM = [
  {
    id: 0, navId: 'planet:solar.earth', name: '地球', type: '繁茂家园', surface: 'grass',
    aAU: 1.0, angleDeg: 100.46, radiusKm: 6371, gravityG: 9.81, dayHours: 24, tempC: 15, atmoDensity: 1.0,
    grassHue: 0, skyTop: 0x3d8fd4, skyHorizon: 0xcfe8f0,
    surfaceColors: [0x2f5a9a, 0x4f9a5a], atmos: 0x7fd4ff,
    terrain: { base: 26, amp: 1.0, mounts: 1.0, caves: 1.0, trees: 1.15 },
    ores: { coal: 1, ferrock: 1, copper: 1, gold: 1 },
    plants: { sodium: 1, oxygen: 1, dihydrogen: 1, carbon: 1 },
    hazard: { kind: 'mild', drain: 2.2, when: 'night', label: '夜间低温' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    ring: false,
    facts: ['唯一已知拥有液态水海洋的行星', '拥有一颗大型天然卫星：月球', '自转周期 23.93 小时 · 公转周期 365.25 天'],
  },
  {
    id: 1, navId: 'planet:solar.venus', name: '金星', type: '剧毒温室', surface: 'toxic',
    aAU: 0.7233, angleDeg: 181.98, radiusKm: 6051.8, gravityG: 8.87, dayHours: -2802, tempC: 464, atmoDensity: 2.3, underground: 'magma',
    grassHue: 105, skyTop: 0x8a6a2a, skyHorizon: 0xe8d090,
    surfaceColors: [0xb09840, 0xd8c060], atmos: 0xffe090,
    terrain: { base: 20, amp: 0.5, mounts: 1.6, caves: 1.2, trees: 0 },
    ores: { coal: 1.2, ferrock: 1.2, copper: 1.6, gold: 2.2 },
    plants: { sodium: 2, oxygen: 1.2, dihydrogen: 0.8, carbon: 1.5 },
    hazard: { kind: 'toxic', drain: 2.0, when: 'always', label: '剧毒大气' },
    weather: { kind: 'dust', freq: 3, dur: 40 },
    ring: false,
    facts: ['太阳系最热的行星：表面均温 464°C', '逆向自转：太阳从西方升起', '大气压约为地球的 92 倍'],
  },
  {
    id: 2, navId: 'planet:solar.mercury', name: '水星', type: '灼热荒岩', surface: 'barren',
    aAU: 0.3871, angleDeg: 252.25, radiusKm: 2439.7, gravityG: 3.7, dayHours: 4222.6, tempC: 167, atmoDensity: 0.25, underground: 'magma',
    grassHue: -28, skyTop: 0x2a2a35, skyHorizon: 0x9a8a7a,
    surfaceColors: [0x8a7a6a, 0xb09a88], atmos: 0xffd090,
    terrain: { base: 24, amp: 0.6, mounts: 1.9, caves: 1.4, trees: 0 },
    ores: { coal: 2.2, ferrock: 1.4, copper: 1.5, gold: 1.6 },
    plants: { sodium: 0.5, oxygen: 0.5, dihydrogen: 0.5, carbon: 1.5 },
    hazard: { kind: 'hot', drain: 2.6, when: 'day', label: '烈日灼烧' },
    weather: { kind: 'dust', freq: 0.8, dur: 25 },
    ring: false,
    facts: ['距太阳最近的行星：0.387 AU', '昼夜温差超过 600°C', '一昼夜 ≈ 176 个地球日'],
  },
  {
    id: 3, navId: 'planet:solar.mars', name: '火星', type: '红色荒漠', surface: 'mars',
    aAU: 1.5237, angleDeg: 355.45, radiusKm: 3389.5, gravityG: 3.71, dayHours: 24.66, tempC: -65, atmoDensity: 0.55,
    grassHue: 0, skyTop: 0xb86a4a, skyHorizon: 0xe8b890,
    surfaceColors: [0xb05535, 0xd88055], atmos: 0xff9a6a,
    terrain: { base: 22, amp: 0.45, mounts: 2.2, caves: 1.0, trees: 0 },
    ores: { coal: 0.8, ferrock: 2.6, copper: 1.8, gold: 0.9 },
    plants: { sodium: 0.6, oxygen: 0.6, dihydrogen: 0.6, carbon: 1.2 },
    hazard: { kind: 'cold', drain: 1.2, when: 'night', label: '夜间严寒' },
    weather: { kind: 'dust', freq: 1.6, dur: 45 },
    ring: false,
    facts: ['拥有太阳系最高峰：奥林帕斯山', '赤铁矿物让地表呈锈红色', '自转周期 24.66 小时，与地球最接近'],
  },
  {
    id: 4, navId: 'planet:solar.jupiter', name: '木星', type: '气态巨行星', surface: 'jupiter',
    aAU: 5.2026, angleDeg: 34.40, radiusKm: 69911, gravityG: 24.79, dayHours: 9.93, tempC: -110, atmoDensity: 1.35,
    grassHue: -35, skyTop: 0x8a6a3a, skyHorizon: 0xe0c090,
    surfaceColors: [0xc8a060, 0xe8c890], atmos: 0xffe0b0,
    terrain: { base: 18, amp: 0.4, mounts: 2.6, caves: 0.6, trees: 0 },
    ores: { coal: 1.8, ferrock: 0.8, copper: 0.8, gold: 1.4 },
    plants: { sodium: 1, oxygen: 1.5, dihydrogen: 1, carbon: 2 },
    hazard: { kind: 'rad', drain: 1.8, when: 'always', label: '辐射风暴' },
    weather: { kind: 'dust', freq: 2.6, dur: 35 },
    ring: false,
    facts: ['太阳系最大行星：可装下 1300 多个地球', '大红斑风暴已持续数百年', '四大伽利略卫星：木卫一/二/三/四'],
  },
  {
    id: 5, navId: 'planet:solar.saturn', name: '土星', type: '环带气态行星', surface: 'jupiter',
    aAU: 9.5549, angleDeg: 49.94, radiusKm: 58232, gravityG: 10.44, dayHours: 10.7, tempC: -140, atmoDensity: 1.2,
    grassHue: -15, skyTop: 0x9a8a4a, skyHorizon: 0xe8d8a0,
    surfaceColors: [0xd0b878, 0xe8d8a8], atmos: 0xfff0c0,
    terrain: { base: 18, amp: 0.35, mounts: 2.4, caves: 0.5, trees: 0 },
    ores: { coal: 1.4, ferrock: 0.8, copper: 0.8, gold: 1.8 },
    plants: { sodium: 1, oxygen: 1.5, dihydrogen: 1, carbon: 2 },
    hazard: { kind: 'rad', drain: 1.5, when: 'always', label: '辐射风暴' },
    weather: { kind: 'dust', freq: 2.0, dur: 35 },
    ring: true,
    facts: ['冰晶环宽 28 万公里，厚度仅数十米', '密度低于水：理论上能漂浮', '土卫六拥有浓密大气与甲烷海洋'],
  },
  {
    id: 6, navId: 'planet:solar.uranus', name: '天王星', type: '冰巨星', surface: 'ice',
    aAU: 19.2184, angleDeg: 313.23, radiusKm: 25362, gravityG: 8.87, dayHours: -17.2, tempC: -195, atmoDensity: 0.8,
    grassHue: 55, skyTop: 0x7ac8d8, skyHorizon: 0xd0f0f8,
    surfaceColors: [0x9ad8e8, 0xc8ecf4], atmos: 0xd0ffff,
    terrain: { base: 20, amp: 0.5, mounts: 1.7, caves: 1.1, trees: 0 },
    ores: { coal: 0.8, ferrock: 1.2, copper: 1.4, gold: 1 },
    plants: { sodium: 1, oxygen: 2, dihydrogen: 2.5, carbon: 1 },
    hazard: { kind: 'cold', drain: 2.2, when: 'always', label: '极寒低温' },
    weather: { kind: 'snow', freq: 1.2, dur: 30 },
    ring: false,
    facts: ['自转轴倾斜 98°：几乎“躺着”公转', '大气甲烷吸收红光，呈现青蓝色', '拥有五颗主要卫星'],
  },
  {
    id: 7, navId: 'planet:solar.neptune', name: '海王星', type: '冰巨星', surface: 'ice',
    aAU: 30.1104, angleDeg: 304.88, radiusKm: 24622, gravityG: 11.15, dayHours: 16.1, tempC: -200, atmoDensity: 0.8,
    grassHue: 90, skyTop: 0x3a5a9a, skyHorizon: 0xa0c0e8,
    surfaceColors: [0x4a6a9a, 0x7a9ac0], atmos: 0xb0d0ff,
    terrain: { base: 20, amp: 0.55, mounts: 1.8, caves: 1.1, trees: 0 },
    ores: { coal: 0.8, ferrock: 1.3, copper: 1.5, gold: 1.6 },
    plants: { sodium: 1, oxygen: 2.5, dihydrogen: 3, carbon: 1 },
    hazard: { kind: 'cold', drain: 2.4, when: 'always', label: '极寒低温' },
    weather: { kind: 'snow', freq: 1.8, dur: 30 },
    ring: false,
    facts: ['太阳系风速最高的行星：超 2100 km/h', '海卫一轨道逆行，可能被俘获', '距太阳 30.1 AU，公转一周 165 年'],
  },
];

// 行星类型（兼容旧测试引用）
export const PLANET_TYPES = SOLAR_SYSTEM.map((p) => ({ type: p.type }));

// ---- 比邻星系（三体） ----
export const PROXIMA_SYSTEM = [
  {
    id: 0, navId: 'planet:proxima.b', name: '比邻星 b', type: '潮汐锁定荒原', surface: 'barren',
    aAU: 0.0485, angleDeg: 200, radiusKm: 6792, gravityG: 9.0, dayHours: 268, tempC: -39, atmoDensity: 0.6,
    grassHue: -70, skyTop: 0x6a3a2a, skyHorizon: 0xc08060,
    surfaceColors: [0x8a5a40, 0xb08060], atmos: 0xff9a5a,
    terrain: { base: 20, amp: 0.5, mounts: 1.6, caves: 1.2, trees: 0 },
    ores: { coal: 1.5, ferrock: 1.6, copper: 1.2, gold: 1.4 },
    plants: { sodium: 1, oxygen: 0.8, dihydrogen: 1.2, carbon: 1.5 },
    hazard: { kind: 'rad', drain: 2.0, when: 'always', label: '潮汐辐射' },
    weather: { kind: 'dust', freq: 1.2, dur: 30 },
    ring: false,
    facts: ['位于比邻星宜居带内的类地行星', '可能被潮汐锁定：一面永昼、一面永夜', '距比邻星 0.0485 AU'],
  },
  {
    id: 1, navId: 'planet:proxima.c', name: '比邻星 c', type: '冰封世界', surface: 'ice',
    aAU: 1.489, angleDeg: 90, radiusKm: 11000, gravityG: 11.2, dayHours: 18, tempC: -230, atmoDensity: 0.65,
    grassHue: 40, skyTop: 0x4a6a8a, skyHorizon: 0xa8c8d8,
    surfaceColors: [0x6a8a9a, 0x9ab8c8], atmos: 0xb0d8ff,
    terrain: { base: 19, amp: 0.5, mounts: 1.7, caves: 1.1, trees: 0 },
    ores: { coal: 0.9, ferrock: 1.3, copper: 1.5, gold: 1.6 },
    plants: { sodium: 1, oxygen: 2, dihydrogen: 2.5, carbon: 1 },
    hazard: { kind: 'cold', drain: 2.6, when: 'always', label: '极寒低温' },
    weather: { kind: 'snow', freq: 1.5, dur: 30 },
    ring: false,
    facts: ['比邻星系的冰封巨行星', '距母星 1.49 AU，轨道周期约 5.2 年', '表面温度接近 -230°C'],
  },
  {
    id: 2, navId: 'planet:proxima.d', name: '比邻星 d', type: '环带气态巨行星', surface: 'jupiter',
    aAU: 0.02885, angleDeg: 310, radiusKm: 7200, gravityG: 8.5, dayHours: 13.2, tempC: 87, atmoDensity: 1.1,
    grassHue: -50, skyTop: 0x5a4a7a, skyHorizon: 0xc0a8d8,
    surfaceColors: [0x8a6ab0, 0xb898d8], atmos: 0xd0b0ff,
    terrain: { base: 18, amp: 0.4, mounts: 2.4, caves: 0.6, trees: 0 },
    ores: { coal: 1.2, ferrock: 1, copper: 1, gold: 2 },
    plants: { sodium: 1, oxygen: 1.5, dihydrogen: 1.5, carbon: 2 },
    hazard: { kind: 'rad', drain: 1.8, when: 'always', label: '辐射风暴' },
    weather: { kind: 'dust', freq: 2.0, dur: 35 },
    ring: true,
    facts: ['紧贴红矮星的炽热气态行星', '轨道半径仅 0.029 AU', '公转一周只需约 5 天'],
  },
];

// ---- 天狼星系（恒星图第三节点；行星为“推测行星”，命名保持天文惯例） ----
export const SIRIUS_SYSTEM = [
  {
    id: 0, navId: 'planet:sirius.b', name: '天狼星 b（推测）', type: '灼热荒漠', surface: 'barren',
    aAU: 0.49, angleDeg: 205, radiusKm: 5840, gravityG: 0.92, dayHours: 21.5, tempC: 225, atmoDensity: 0.6, underground: 'magma',
    grassHue: -45, skyTop: 0x7a5a2a, skyHorizon: 0xe8c880,
    surfaceColors: [0xb09060, 0x8a6a40], atmos: 0xffe090,
    terrain: { base: 18, amp: 0.5, mounts: 1.6, caves: 1.2, trees: 0 },
    ores: { coal: 0.8, ferrock: 1.6, copper: 1.5, gold: 1.4 },
    plants: { sodium: 0.6, oxygen: 0.4, dihydrogen: 0.9, carbon: 1.2 },
    hazard: { kind: 'hot', drain: 1.8, when: 'day', label: '炽白日照' },
    weather: { kind: 'dust', freq: 1.2, dur: 28 },
    ring: false,
    facts: ['天狼星 A1V 主序星的近轨推测行星', '白矮星伴星使夜空多一颗暗星', '轨道半长轴 0.49 AU'],
  },
  {
    id: 1, navId: 'planet:sirius.c', name: '天狼星 c（推测）', type: '冰封外缘', surface: 'ice',
    aAU: 4.2, angleDeg: 320, radiusKm: 8200, gravityG: 1.12, dayHours: 15.5, tempC: -195, atmoDensity: 0.7,
    grassHue: 0, skyTop: 0x2a3a5a, skyHorizon: 0x9ac0d8,
    surfaceColors: [0x6a8a9a, 0xa8c8d8], atmos: 0xb0d8ff,
    terrain: { base: 19, amp: 0.5, mounts: 1.7, caves: 1.1, trees: 0 },
    ores: { coal: 0.8, ferrock: 1.4, copper: 1.4, gold: 1.7 },
    plants: { sodium: 0.8, oxygen: 1.8, dihydrogen: 2.2, carbon: 1 },
    hazard: { kind: 'cold', drain: 2.0, when: 'always', label: '深空极寒' },
    weather: { kind: 'snow', freq: 1.2, dur: 30 },
    ring: false,
    facts: ['天狼星系外围冰封推测行星', '距天狼星 4.2 AU', '表面温度约 -195°C'],
  },
];

// ---- 恒星系统注册表（恒星级星图） ----
export const STAR_SYSTEMS = [
  {
    id: 'solar', name: '太阳系', starNavId: 'star:solar', starName: '太阳',
    starClass: 'G2V 黄矮星', distanceLy: 0, radiusKm: 695700, lum: 1, starColor: 0xffd27a,
    planetCount: 8, desc: '我们的家园星系 · 8 大行星 · 主小行星带',
  },
  {
    id: 'proxima', name: '比邻星系', starNavId: 'star:proxima', starName: '比邻星',
    starClass: 'M5.5Ve 红矮星', distanceLy: 4.2465, radiusKm: 107280, lum: 0.0017, starColor: 0xff8a5a,
    planetCount: 3, desc: '离太阳系最近的恒星系统 · 4.2465 光年 · 三体世界',
  },
  {
    id: 'sirius', name: '天狼星系', starNavId: 'star:sirius', starName: '天狼星',
    starClass: 'A1V 蓝白主序星', distanceLy: 8.6, radiusKm: 1190000, lum: 25.4, starColor: 0xdfe8ff,
    planetCount: 2, desc: '夜空最亮恒星 · 8.6 光年 · 白矮星伴星 · 2 颗推测行星',
  },
];

// ---- 恒星节点 ----
export const STARS = {
  'star:solar': {
    navId: 'star:solar', systemId: 'solar', kind: 'star', name: '太阳', en: 'Sol',
    parentId: null, aAU: 0, angleDeg: 0, radiusKm: 695700, gravityG: 274, dayHours: 609.1, tempC: 5505,
    color: 0xffd27a, starClass: 'G2V',
    facts: ['G2V 黄矮星 · 年龄约 46 亿年', '直径约为地球的 109 倍', '核心温度约 1500 万°C'],
  },
  'star:proxima': {
    navId: 'star:proxima', systemId: 'proxima', kind: 'star', name: '比邻星', en: 'Proxima Centauri',
    parentId: null, aAU: 0, angleDeg: 0, radiusKm: 107280, gravityG: 274, dayHours: 1992, tempC: 3042,
    color: 0xff8a5a, starClass: 'M5.5Ve',
    facts: ['距太阳 4.2465 光年的红矮星', '半人马座 α 三合星的一员', '耀斑活动频繁，辐射环境恶劣'],
  },
  'star:sirius': {
    navId: 'star:sirius', systemId: 'sirius', kind: 'star', name: '天狼星', en: 'Sirius',
    parentId: null, aAU: 0, angleDeg: 0, radiusKm: 1190000, gravityG: 274, dayHours: 16.8, tempC: 9940,
    color: 0xdfe8ff, starClass: 'A1V',
    facts: ['夜空最亮恒星 · 距太阳 8.6 光年', '拥有一颗白矮星伴星（天狼星 B）', '表面温度约 9940 K'],
  },
};

// ---- 卫星（行星系统地图数据；月球为首个可登陆卫星，其余为地图/导航节点） ----
const MOON_DEFS = [
  { navId: 'moon:solar.earth.luna', parentId: 'planet:solar.earth', name: '月球', en: 'Luna',
    type: '岩石卫星',
    aAU: 384400 / AU_KM, sunAU: 1.0, radiusKm: 1737.4, gravityG: 1.62, dayHours: 655.7, tempC: -20,
    color: 0xb8b8c0, landable: true,
    surface: 'moon',
    terrain: { base: 18, amp: 0.75, mounts: 1.5, caves: 1.3, trees: 0 },
    ores: { coal: 0.4, ferrock: 1.4, copper: 1.1, gold: 1.2 },
    plants: { sodium: 0.2, oxygen: 0, dihydrogen: 0.5, carbon: 0.6 },
    hazard: { kind: 'cold', drain: 1.6, when: 'night', label: '月夜严寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: {
      grassHue: 0, skyTop: 0x05070c, skyHorizon: 0x1a1e28,
      surface: [0x9a9aa2, 0x5f6068], atmos: 0x8a8f99,
    },
    atmoDensity: 0.2,
    facts: ['距地球 38.44 万公里', '潮汐锁定：永远以同一面朝向地球', '阿波罗 11 号着陆点位于静海', '重力仅地球的 1/6 · 无大气层'],
  },
  { navId: 'moon:solar.mars.phobos', parentId: 'planet:solar.mars', name: '火卫一', en: 'Phobos',
    aAU: 9376 / AU_KM, radiusKm: 11.3, gravityG: 0.0057, dayHours: 7.7, tempC: -40, color: 0x9a8a7a,
    facts: ['距火星表面仅约 6000 公里', '轨道持续衰减，终将坠入火星'] },
  { navId: 'moon:solar.mars.deimos', parentId: 'planet:solar.mars', name: '火卫二', en: 'Deimos',
    aAU: 23463 / AU_KM, radiusKm: 6.2, gravityG: 0.003, dayHours: 30.3, tempC: -40, color: 0x8a7a6a,
    facts: ['太阳系最小的卫星之一'] },
  { navId: 'moon:solar.jupiter.io', parentId: 'planet:solar.jupiter', name: '木卫一', en: 'Io',
    type: '火山卫星', surface: 'barren',
    aAU: 421700 / AU_KM, sunAU: 5.2026, radiusKm: 1821.6, gravityG: 1.796, dayHours: 42.5, tempC: -130,
    color: 0xe8d070, landable: true, atmoDensity: 0.25, underground: 'magma',
    terrain: { base: 16, amp: 0.45, mounts: 1.3, caves: 1.0, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.8, copper: 1.6, gold: 1.1 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 0.7, carbon: 0.9 },
    hazard: { kind: 'hot', drain: 1.8, when: 'always', label: '硫火山活动' },
    weather: { kind: 'dust', freq: 1.5, dur: 28 },
    palette: { grassHue: -20, skyTop: 0x3a2a14, skyHorizon: 0xc8a050, surface: [0xc8b060, 0x8a5a20], atmos: 0xffc060 },
    facts: ['太阳系火山活动最剧烈的天体', '表面覆盖硫磺与硅酸盐熔岩', '轨道周期 1.77 天'] },
  { navId: 'moon:solar.jupiter.europa', parentId: 'planet:solar.jupiter', name: '木卫二', en: 'Europa',
    type: '冰下海洋卫星', surface: 'ice',
    aAU: 671034 / AU_KM, sunAU: 5.2026, radiusKm: 1560.8, gravityG: 1.315, dayHours: 85.2, tempC: -160,
    color: 0xd8c8a8, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.35, mounts: 0.9, caves: 1.2, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.3, copper: 1.4, gold: 0.8 },
    plants: { sodium: 0.6, oxygen: 0, dihydrogen: 1.2, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.2, when: 'always', label: '冰面严寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: 0, skyTop: 0x101820, skyHorizon: 0x8a9ab0, surface: [0xc8d8e8, 0x8a9ab0], atmos: 0x9ad8ff },
    facts: ['冰壳下可能存在液态水海洋', '寻找地外生命的重要候选', '表面遍布红色冰裂缝'] },
  { navId: 'moon:solar.jupiter.ganymede', parentId: 'planet:solar.jupiter', name: '木卫三', en: 'Ganymede',
    type: '巨卫星', surface: 'barren',
    aAU: 1070412 / AU_KM, sunAU: 5.2026, radiusKm: 2634.1, gravityG: 1.428, dayHours: 171.7, tempC: -163,
    color: 0xb8a890, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.5, mounts: 1.4, caves: 1.2, trees: 0 },
    ores: { coal: 0.6, ferrock: 1.6, copper: 1.3, gold: 1.0 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 0.9, carbon: 0.8 },
    hazard: { kind: 'cold', drain: 1.0, when: 'night', label: '夜间严寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: -15, skyTop: 0x1a1c22, skyHorizon: 0x9a948a, surface: [0xb0a894, 0x6a645c], atmos: 0xb8b0a0 },
    facts: ['太阳系最大的卫星：比水星还大', '唯一拥有内禀磁场的卫星', '暗色陨击区与明亮沟槽交错'] },
  { navId: 'moon:solar.jupiter.callisto', parentId: 'planet:solar.jupiter', name: '木卫四', en: 'Callisto',
    type: '古老冰岩卫星', surface: 'barren',
    aAU: 1882709 / AU_KM, sunAU: 5.2026, radiusKm: 2410.3, gravityG: 1.235, dayHours: 400.5, tempC: -139,
    color: 0x9a8a7a, landable: true, atmoDensity: 0.2,
    terrain: { base: 16, amp: 0.4, mounts: 1.1, caves: 1.0, trees: 0 },
    ores: { coal: 0.7, ferrock: 1.5, copper: 1.2, gold: 1.2 },
    plants: { sodium: 0.3, oxygen: 0, dihydrogen: 0.8, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.1, when: 'always', label: '深空严寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: -10, skyTop: 0x101418, skyHorizon: 0x8a847c, surface: [0x9a8f80, 0x5a554e], atmos: 0x9a948a },
    facts: ['表面遍布陨击坑，地质最古老', '位于木星磁层之外，辐射较低'] },
  { navId: 'moon:solar.saturn.titan', parentId: 'planet:solar.saturn', name: '土卫六', en: 'Titan',
    type: '浓密大气卫星', surface: 'toxic',
    aAU: 1221870 / AU_KM, sunAU: 9.5549, radiusKm: 2574.7, gravityG: 1.352, dayHours: 382.7, tempC: -179,
    color: 0xe0b060, landable: true, atmoDensity: 1.6,
    terrain: { base: 16, amp: 0.35, mounts: 1.0, caves: 0.8, trees: 0 },
    ores: { coal: 1.4, ferrock: 1.0, copper: 1.0, gold: 1.3 },
    plants: { sodium: 1.0, oxygen: 0.6, dihydrogen: 1.2, carbon: 2.0 },
    hazard: { kind: 'cold', drain: 1.4, when: 'always', label: '甲烷寒雾' },
    weather: { kind: 'dust', freq: 1.4, dur: 35 },
    palette: { grassHue: 22, skyTop: 0x4a3a1a, skyHorizon: 0xc8a860, surface: [0xb89050, 0x8a6a30], atmos: 0xffc070 },
    facts: ['太阳系唯一拥有浓密大气的卫星', '表面有液态甲烷海洋与湖泊', '大气压约为地球的 1.5 倍'] },
  { navId: 'moon:solar.saturn.rhea', parentId: 'planet:solar.saturn', name: '土卫五', en: 'Rhea',
    aAU: 527108 / AU_KM, radiusKm: 763.8, gravityG: 0.264, dayHours: 108.4, tempC: -174, color: 0xc8c0b8,
    facts: ['土星第二大卫星，冰与岩石混合'] },
  { navId: 'moon:solar.saturn.iapetus', parentId: 'planet:solar.saturn', name: '土卫八', en: 'Iapetus',
    aAU: 3560820 / AU_KM, radiusKm: 734.5, gravityG: 0.223, dayHours: 1903.9, tempC: -199, color: 0x8a7a6a,
    facts: ['半球明暗反差巨大，形似“阴阳脸”'] },
  { navId: 'moon:solar.saturn.dione', parentId: 'planet:solar.saturn', name: '土卫四', en: 'Dione',
    aAU: 377396 / AU_KM, radiusKm: 561.4, gravityG: 0.232, dayHours: 65.7, tempC: -186, color: 0xb0a8a0,
    facts: ['表面有明亮冰崖与幽暗平原'] },
  { navId: 'moon:solar.saturn.tethys', parentId: 'planet:solar.saturn', name: '土卫三', en: 'Tethys',
    aAU: 294619 / AU_KM, radiusKm: 531.1, gravityG: 0.146, dayHours: 45.3, tempC: -187, color: 0xb8b0a8,
    facts: ['奥德修斯陨击坑直径超过 400 公里'] },
  { navId: 'moon:solar.saturn.enceladus', parentId: 'planet:solar.saturn', name: '土卫二', en: 'Enceladus',
    aAU: 237948 / AU_KM, radiusKm: 252.1, gravityG: 0.113, dayHours: 32.9, tempC: -198, color: 0xe8e8f0,
    facts: ['南极喷出含盐冰晶羽流，暗示地下海洋'] },
  { navId: 'moon:solar.uranus.titania', parentId: 'planet:solar.uranus', name: '天卫三', en: 'Titania',
    type: '冰岩卫星', surface: 'ice',
    aAU: 435910 / AU_KM, sunAU: 19.2184, radiusKm: 788.4, gravityG: 0.38, dayHours: 208.9, tempC: -203,
    color: 0xb8b8c0, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.4, mounts: 1.2, caves: 1.1, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.4, copper: 1.3, gold: 1.2 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 1.2, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.6, when: 'always', label: '深空极寒' },
    weather: { kind: 'snow', freq: 0.7, dur: 25 },
    palette: { grassHue: 0, skyTop: 0x0c1218, skyHorizon: 0x8a98a8, surface: [0xb8c4d0, 0x7a8898], atmos: 0x9ac0d8 },
    facts: ['天王星最大的卫星', '冰与岩石混合表面'] },
  { navId: 'moon:solar.uranus.oberon', parentId: 'planet:solar.uranus', name: '天卫四', en: 'Oberon',
    type: '古老冰卫星', surface: 'ice',
    aAU: 583520 / AU_KM, sunAU: 19.2184, radiusKm: 761.4, gravityG: 0.348, dayHours: 323.1, tempC: -203,
    color: 0xa8a0a0, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.45, mounts: 1.1, caves: 1.1, trees: 0 },
    ores: { coal: 0.6, ferrock: 1.3, copper: 1.2, gold: 1.1 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 1.1, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.5, when: 'always', label: '深空极寒' },
    weather: { kind: 'snow', freq: 0.7, dur: 25 },
    palette: { grassHue: 0, skyTop: 0x0c1218, skyHorizon: 0x8a98a8, surface: [0xa8a8b0, 0x707080], atmos: 0x98b0c8 },
    facts: ['表面有暗色沉积物覆盖的古老陨击坑'] },
  { navId: 'moon:solar.uranus.umbriel', parentId: 'planet:solar.uranus', name: '天卫二', en: 'Umbriel',
    type: '暗色冰卫星', surface: 'barren',
    aAU: 266000 / AU_KM, sunAU: 19.2184, radiusKm: 584.7, gravityG: 0.2, dayHours: 99.5, tempC: -200,
    color: 0x8a8a92, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.35, mounts: 1.0, caves: 1.1, trees: 0 },
    ores: { coal: 0.7, ferrock: 1.4, copper: 1.2, gold: 1.0 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 1.0, carbon: 0.8 },
    hazard: { kind: 'cold', drain: 1.5, when: 'always', label: '深空极寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: 0, skyTop: 0x0c1018, skyHorizon: 0x848890, surface: [0x8a8e96, 0x585c64], atmos: 0x8a9aac },
    facts: ['天王星卫星中表面最暗的一颗'] },
  { navId: 'moon:solar.uranus.ariel', parentId: 'planet:solar.uranus', name: '天卫一', en: 'Ariel',
    type: '年轻冰卫星', surface: 'ice',
    aAU: 191020 / AU_KM, sunAU: 19.2184, radiusKm: 578.9, gravityG: 0.269, dayHours: 60.5, tempC: -213,
    color: 0xb0b8c0, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.4, mounts: 1.2, caves: 1.2, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.4, copper: 1.3, gold: 1.0 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 1.3, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.6, when: 'always', label: '深空极寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: 0, skyTop: 0x0c1218, skyHorizon: 0x8a98a8, surface: [0xb0bcc8, 0x788898], atmos: 0x9ac0d8 },
    facts: ['拥有年轻冰谷地貌'] },
  { navId: 'moon:solar.uranus.miranda', parentId: 'planet:solar.uranus', name: '天卫五', en: 'Miranda',
    type: '破碎冰卫星', surface: 'ice',
    aAU: 129390 / AU_KM, sunAU: 19.2184, radiusKm: 235.8, gravityG: 0.079, dayHours: 33.9, tempC: -187,
    color: 0xc0c8d0, landable: true, atmoDensity: 0.2,
    terrain: { base: 16, amp: 0.55, mounts: 1.6, caves: 1.2, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.4, copper: 1.3, gold: 1.2 },
    plants: { sodium: 0.4, oxygen: 0, dihydrogen: 1.3, carbon: 0.7 },
    hazard: { kind: 'cold', drain: 1.5, when: 'always', label: '深空极寒' },
    weather: { kind: 'none', freq: 0, dur: 0 },
    palette: { grassHue: 0, skyTop: 0x0c1218, skyHorizon: 0x8a98a8, surface: [0xc0c8d0, 0x808890], atmos: 0x98b8d0 },
    facts: ['维罗纳断崖高达约 20 公里', '破碎地貌暗示曾被撞击重组'] },
  { navId: 'moon:solar.neptune.triton', parentId: 'planet:solar.neptune', name: '海卫一', en: 'Triton',
    type: '氮冰卫星', surface: 'ice',
    aAU: 354759 / AU_KM, sunAU: 30.1104, radiusKm: 1353.4, gravityG: 0.779, dayHours: -141, tempC: -235,
    color: 0xc8d8e8, landable: true, atmoDensity: 0.2,
    terrain: { base: 17, amp: 0.4, mounts: 1.2, caves: 1.1, trees: 0 },
    ores: { coal: 0.5, ferrock: 1.4, copper: 1.4, gold: 1.3 },
    plants: { sodium: 0.5, oxygen: 0, dihydrogen: 1.6, carbon: 0.6 },
    hazard: { kind: 'cold', drain: 2.0, when: 'always', label: '深空极寒' },
    weather: { kind: 'snow', freq: 0.8, dur: 25 },
    palette: { grassHue: 0, skyTop: 0x0a1018, skyHorizon: 0x8aa0b8, surface: [0xc8dcec, 0x7a90a8], atmos: 0x9ad0f0 },
    facts: ['逆行轨道：可能是被俘获的柯伊伯带天体', '氮冰间歇泉喷发', '太阳系最冷的主要天体之一'] },
];

// ---- 小行星带 / 空间站 / 跃迁门（与行星同级的重要空间节点） ----
export const BELT_NODES = {
  'belt:solar.main': {
    navId: 'belt:solar.main', systemId: 'solar', kind: 'belt', name: '主小行星带', en: 'Main Asteroid Belt',
    parentId: 'star:solar', aAU: 2.7, angleDeg: 118, radiusKm: 469.7, gravityG: 0.27, dayHours: 9.1, tempC: -73,
    color: 0x8a7a6a, landable: false,
    facts: ['位于火星与木星之间：2.2–3.2 AU', '包含谷神星等超过百万颗小天体', '太阳系行星形成的“原材料仓库”'],
  },
};

export const STATION_NODES = {
  'station:solar.earth': {
    navId: 'station:solar.earth', systemId: 'solar', kind: 'station', name: '地球轨道空间站',
    parentId: 'planet:solar.earth', aAU: 0, angleDeg: 0, radiusKm: 0, gravityG: 0, dayHours: 24, tempC: 15,
    color: 0x7ff0ff, landable: false, dockable: true,
    facts: ['距地表约 420 公里 · 地球静止轨道', '交易中心 / 收购订单 / 飞船船坞 / 人员', '大型殖民船“曙光号”在此交付'],
  },
};

export const GATEWAY_NODES = {
  'gateway:solar.proxima': {
    navId: 'gateway:solar.proxima', systemId: 'solar', kind: 'gateway', name: '比邻星系跃迁点',
    parentId: 'star:solar', aAU: 0, angleDeg: 0, radiusKm: 0, gravityG: 0, dayHours: 0, tempC: 0,
    color: 0x2fb8d8, landable: false, gateway: true, targetSystem: 'proxima', meta: '跨星系跃迁 · 比邻星（三体）',
    offset: { x: 4200, y: 300, z: 2200 },
    facts: ['跨星系跃迁门：太阳系 ↔ 比邻星系', '需要大型殖民船才能穿越'],
  },
  'gateway:proxima.solar': {
    navId: 'gateway:proxima.solar', systemId: 'proxima', kind: 'gateway', name: '太阳系跃迁点',
    parentId: 'star:proxima', aAU: 0, angleDeg: 0, radiusKm: 0, gravityG: 0, dayHours: 0, tempC: 0,
    color: 0x2fb8d8, landable: false, gateway: true, targetSystem: 'solar', meta: '跨星系跃迁 · 返回太阳系',
    offset: { x: -4200, y: 300, z: -2200 },
    facts: ['跨星系跃迁门：比邻星系 ↔ 太阳系'],
  },
  'gateway:solar.sirius': {
    navId: 'gateway:solar.sirius', systemId: 'solar', kind: 'gateway', name: '天狼星系跃迁点',
    parentId: 'star:solar', aAU: 0, angleDeg: 0, radiusKm: 0, gravityG: 0, dayHours: 0, tempC: 0,
    color: 0x4fb8e8, landable: false, gateway: true, targetSystem: 'sirius', meta: '跨星系跃迁 · 天狼星（8.6 光年）',
    offset: { x: -4600, y: 300, z: 2600 },
    facts: ['跨星系跃迁门：太阳系 ↔ 天狼星系', '需要大型殖民船才能穿越'],
  },
  'gateway:sirius.solar': {
    navId: 'gateway:sirius.solar', systemId: 'sirius', kind: 'gateway', name: '太阳系跃迁点',
    parentId: 'star:sirius', aAU: 0, angleDeg: 0, radiusKm: 0, gravityG: 0, dayHours: 0, tempC: 0,
    color: 0x4fb8e8, landable: false, gateway: true, targetSystem: 'solar', meta: '跨星系跃迁 · 返回太阳系',
    offset: { x: 4600, y: 300, z: -2600 },
    facts: ['跨星系跃迁门：天狼星系 ↔ 太阳系'],
  },
};

// 空间节点世界坐标偏移（兼容旧 system.js 常量；x/z 相对进入太空点）
export const STATION_OFFSET = { x: 260, y: 420, z: 170 };
export const GATEWAY_OFFSETS = {
  solar: { x: 4200, y: 300, z: 2200 },
  proxima: { x: -4200, y: 300, z: -2200 },
  sirius: { x: 4600, y: 300, z: -2600 },
};

// ---- 注册表构建 ----
function buildRegistry() {
  const map = new Map();
  const add = (node) => map.set(node.navId, node);
  for (const star of Object.values(STARS)) add(star);
  for (const def of [...SOLAR_SYSTEM, ...PROXIMA_SYSTEM, ...SIRIUS_SYSTEM]) {
    const systemId = def.navId.split(':')[1].split('.')[0];
    add({
      navId: def.navId, kind: 'planet', systemId, parentId: `star:${systemId}`,
      name: def.name, type: def.type, surface: def.surface,
      aAU: def.aAU, angleDeg: def.angleDeg, radiusKm: def.radiusKm,
      gravityG: def.gravityG, dayHours: def.dayHours, tempC: def.tempC, atmoDensity: def.atmoDensity || 1,
      underground: def.underground || null,
      color: def.surfaceColors ? def.surfaceColors[0] : 0xcccccc,
      landable: true, ring: !!def.ring, facts: def.facts || [],
      terrain: def.terrain, ores: def.ores, plants: def.plants,
      hazard: def.hazard, weather: def.weather, palette: {
        grassHue: def.grassHue, skyTop: def.skyTop, skyHorizon: def.skyHorizon,
        surface: def.surfaceColors, atmos: def.atmos,
      },
    });
  }
  for (const node of Object.values(BELT_NODES)) add(node);
  for (const node of Object.values(STATION_NODES)) add(node);
  for (const node of Object.values(GATEWAY_NODES)) add(node);
  for (const def of MOON_DEFS) {
    const parent = map.get(def.parentId);
    add({
      ...def,
      kind: 'moon', systemId: parent ? parent.systemId : 'solar', landable: !!def.landable,
      type: def.type || '天然卫星',
    });
  }
  return map;
}

const REGISTRY = buildRegistry();

export function bodyById(navId) {
  return REGISTRY.get(String(navId)) || null;
}

export function bodiesOfSystem(systemId) {
  const out = [];
  for (const node of REGISTRY.values()) if (node.systemId === systemId) out.push(node);
  return out;
}

export function planetsOfSystem(systemId) {
  if (systemId === 'proxima') return PROXIMA_SYSTEM;
  if (systemId === 'sirius') return SIRIUS_SYSTEM;
  return SOLAR_SYSTEM;
}

export function systemMeta(systemId) {
  return STAR_SYSTEMS.find((s) => s.id === systemId) || STAR_SYSTEMS[0];
}

export function homeBodyId(systemId) {
  if (systemId === 'proxima') return 'planet:proxima.b';
  if (systemId === 'sirius') return 'planet:sirius.b';
  return 'planet:solar.earth';
}

// 卫星世界种子：由游戏种子 + 卫星 id 确定性派生（与行星种子同一体系）
export function moonSeedOf(gameSeed, moonNavId) {
  return String(hashSeed(gameSeed + ':moon:' + moonNavId));
}

export function childrenOf(systemId, bodyId) {
  const list = [];
  for (const node of REGISTRY.values()) {
    if (node.systemId === systemId && node.parentId === bodyId) list.push(node);
  }
  list.sort((a, b) => a.aAU - b.aAU);
  return list;
}

// 太阳系系统级节点：太阳 → 行星（按真实轨道排序）→ 小行星带 → 空间站/跃迁门
export function systemLevelNodes(systemId) {
  const nodes = [];
  const star = bodyById(`star:${systemId}`);
  if (star) nodes.push(star);
  const planets = planetsOfSystem(systemId).map((d) => bodyById(d.navId)).filter(Boolean);
  planets.sort((a, b) => a.aAU - b.aAU);
  nodes.push(...planets);
  if (systemId === 'solar') {
    const belt = bodyById('belt:solar.main');
    if (belt) nodes.splice(1 + planets.findIndex((p) => p.navId === 'planet:solar.mars') + 1, 0, belt);
  }
  if (systemId === 'solar') nodes.push(bodyById('station:solar.earth'));
  // 当前星系所有外向跃迁门（数据驱动，未来新增恒星系统无需改此处）
  for (const node of REGISTRY.values()) {
    if (node.kind === 'gateway' && node.systemId === systemId) nodes.push(node);
  }
  return nodes.filter(Boolean);
}

// ---- 轨道几何（世界旅程坐标，原点 = 恒星） ----
export function orbitPos(def) {
  const rad = (def.angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * def.aAU * AU, z: Math.sin(rad) * def.aAU * AU };
}

export function visualRadius(def) {
  // 立方根压缩：保留相对大小次序，又不会让木星/太阳占满屏幕
  const r = def.radiusKm || 1;
  return Math.max(2, Math.cbrt(r) * 2.5);
}

const clampLocal = (v, a, b) => v < a ? a : v > b ? b : v;

// ---- 行星本质差异化（纯函数：真实数据 → 可玩参数） ----
// 重力系数：地球 = 1。气态巨行星表面重力巨大但夹到 2.0（跳不起来会破坏可玩性），
// 月球/火星/水星这类低重力世界明显更“飘”。
export function gravityFactor(def) {
  const g = def && Number.isFinite(def.gravityG) ? def.gravityG : 9.81;
  return clampLocal(g / 9.81, 0.15, 2.0);
}

// 昼夜周期（秒）：保留真实自转快慢的排序，但用平方根压缩到可玩范围
// （水星 176 天 / 金星 243 天这种极端值不能直接照搬，否则白天永远不变化）。
export function dayLengthSeconds(def) {
  const h = Math.abs((def && def.dayHours) || 24);
  return Math.round(clampLocal(480 * Math.sqrt(h / 24), 120, 1200));
}

// 太阳视大小系数：1 / sqrt(轨道半径)。水星上太阳比地球大 ~1.6 倍，
// 海王星上缩小为 0.18 倍——关闭 UI 也能感知“我离太阳很远”。
export function sunScaleFor(def) {
  const aAU = def && Number.isFinite(def.aAU) ? Math.abs(def.aAU) : 1;
  return clampLocal(1 / Math.sqrt(Math.max(0.05, aAU)), 0.18, 2.4);
}

// 天空着色器中的太阳圆盘锐度参数（scale 越大圆盘越大）
export function sunDiscParams(def) {
  const s = sunScaleFor(def);
  return {
    scale: s,
    sharp: clampLocal(220 / (s * s), 40, 1200),
    soft: clampLocal(8 / (s * s), 3, 60),
  };
}

// 大气密度：1 = 地球。剧毒金星浓雾弥漫，火星/荒岩世界空气稀薄、星空更亮。
export function atmoDensityOf(def) {
  return clampLocal((def && def.atmoDensity) || 1, 0.2, 2.5);
}

// 大气阻力系数：地球 = 1。金星浓密大气明显拖慢飞船，无大气卫星（密度 < 0.3）
// 几乎不减速——真空滑翔手感与稠密大气完全拉开差距。
export function airDragFactor(def) {
  const d = atmoDensityOf(def);
  if (d < 0.3) return 0.15;
  return clampLocal(0.4 + 0.6 * d, 0.4, 2.0);
}

// 大气再入热障强度（0 = 无大气，无再入等离子体）：决定粒子密度与屏幕灼热程度。
export function reentryStrengthOf(def) {
  const d = atmoDensityOf(def);
  if (d < 0.3) return 0;
  return clampLocal(0.25 + (d - 0.3) * 0.5, 0.25, 1);
}

// 大气再入热障持续秒数：金星最长、地球次之、火星稀薄大气短促、月球为 0。
export function reentryDurationOf(def) {
  const d = atmoDensityOf(def);
  if (d < 0.3) return 0;
  return clampLocal(0.8 + 0.9 * d, 0.8, 2.6);
}

// 恒星颜色（太阳系黄白 / 比邻星系红矮星橙红 / 天狼星蓝白）
export function starColorOf(systemId) {
  if (systemId === 'proxima') return 0xff9a68;
  if (systemId === 'sirius') return 0xdfe8ff;
  return 0xfff2c0;
}

// 卫星在世界旅程坐标中的轨道（视觉尺度：环绕母行星球体，而非淹没在球体内）
export function moonOrbitRadius(parentVisualRadius, ordinal, moonCount) {
  const gap = Math.max(14, parentVisualRadius * 0.9);
  return parentVisualRadius * 1.55 + (ordinal + 1) * gap * (moonCount > 4 ? 0.75 : 1);
}

export function moonOffset(node, parentBody, ordinal = 0, moonCount = 1) {
  const r = moonOrbitRadius(visualRadius(parentBody), ordinal, moonCount);
  const rad = (node.angleDeg || 30 + ordinal * 57) * Math.PI / 180;
  return { x: Math.cos(rad) * r, z: Math.sin(rad) * r };
}

// 节点相对当前母星（currentPlanetDef）的世界旅程偏移
export function worldOffset(node, currentPlanetDef, ordinal = -1, moonCount = 0) {
  if (!node) return null;
  const homePos = orbitPos(currentPlanetDef);
  if (node.kind === 'star' || node.kind === 'planet' || node.kind === 'belt') {
    const p = orbitPos(node);
    return { x: p.x - homePos.x, z: p.z - homePos.z };
  }
  if (node.kind === 'moon') {
    const parent = bodyById(node.parentId);
    const siblings = childrenOf(node.systemId, node.parentId);
    const idx = Math.max(0, siblings.findIndex((s) => s.navId === node.navId));
    const off = moonOffset(node, parent, ordinal >= 0 ? ordinal : idx, moonCount || siblings.length || 1);
    // 卫星 = 母行星相对当前位置的偏移 + 行星系内局部轨道（允许导航到非当前行星的卫星）
    const parentPos = parent ? orbitPos(parent) : { x: 0, z: 0 };
    return { x: parentPos.x - homePos.x + off.x, z: parentPos.z - homePos.z + off.z };
  }
  if (node.kind === 'station') return { x: STATION_OFFSET.x, z: STATION_OFFSET.z };
  if (node.kind === 'gateway') {
    const off = node.offset || GATEWAY_OFFSETS[currentPlanetDef.navId.includes(':solar.') ? 'solar' : 'proxima'];
    return { x: off.x, z: off.z };
  }
  return null;
}

// ---- 星图投影（对数尺度：内行星不挤成一团，外行星不出界） ----
export function logProject(v, vmin, vmax, rmin, rmax) {
  const safe = (x) => Math.log10(Math.max(1e-6, x + 1));
  const t = (safe(v) - safe(vmin)) / Math.max(1e-9, safe(vmax) - safe(vmin));
  return rmin + Math.max(0, Math.min(1, t)) * (rmax - rmin);
}

export function systemOrbitRange(systemId) {
  const planets = planetsOfSystem(systemId);
  let min = Infinity, max = -Infinity;
  for (const p of planets) {
    min = Math.min(min, p.aAU);
    max = Math.max(max, p.aAU);
  }
  return { min, max };
}

// ---- 距离格式化（旅程单位 → AU / 公里） ----
export function formatDistance(units) {
  if (units === null || units === undefined || !Number.isFinite(units)) return '—';
  const au = units / AU;
  if (au >= 0.01) return `${au.toFixed(2)} AU`;
  const km = units * KM_PER_UNIT;
  if (km >= 1000) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${Math.round(km)} km`;
}

// 信息面板：把统一记录渲染成可读事实行
export function bodyFacts(node, extra = {}) {
  if (!node) return [];
  const lines = [];
  const kindLabel = { star: '恒星', planet: '行星', moon: '卫星', belt: '小行星带', station: '空间站', gateway: '跃迁门' }[node.kind] || '天体';
  lines.push(`分类：${kindLabel}${node.type ? ' · ' + node.type : ''}`);
  if (node.kind === 'star') lines.push(`光谱型：${node.starClass || '—'}`);
  if (node.aAU > 0) {
    lines.push(`轨道半长轴：${node.aAU.toFixed(4)} AU`);
  }
  if (node.radiusKm > 0) lines.push(`半径：${node.radiusKm.toLocaleString('en-US')} km`);
  if (node.gravityG > 0) lines.push(`表面重力：${node.gravityG} g`);
  if (node.dayHours) lines.push(`自转周期：${Math.abs(node.dayHours).toFixed(1)} 小时${node.dayHours < 0 ? '（逆行）' : ''}`);
  if (node.tempC !== undefined) lines.push(`表面均温：${node.tempC}°C`);
  if (node.landable) lines.push('状态：可跃迁降落');
  else if (node.dockable) lines.push('状态：可停靠');
  else if (node.kind === 'moon') lines.push('状态：地图/导航节点（登陆舱建设中）');
  else if (node.kind === 'star' || node.kind === 'belt') lines.push('状态：可导航 · 不可降落');
  if (extra.distance !== undefined && extra.distance !== null) lines.push(`距当前位置：${formatDistance(extra.distance)}`);
  for (const f of node.facts || []) lines.push(`· ${f}`);
  return lines;
}
