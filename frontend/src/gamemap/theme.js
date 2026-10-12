// 剧情图谱主题令牌：深空暗色（源自 gamemap theme.ts，原样保留）+ 浅色变体。
// Doublog 联动方式：由 GamemapShell 的 dark prop 决定用哪套（不读 localStorage、
// 不自有开关），antd ConfigProvider 只包 gamemap 子树。
import { theme as antdTheme } from 'antd'

/** 全局设计令牌：深空暗色 + 霓虹点缀（源版原样） */
export const darkTheme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#7c5cff',
    colorInfo: '#4096ff',
    colorSuccess: '#2ed573',
    colorWarning: '#ffb020',
    colorError: '#ff4d6a',
    colorBgBase: '#0b0d14',
    colorBgContainer: '#141824',
    colorBgElevated: '#1a1f2e',
    colorBgLayout: '#0b0d14',
    colorBorder: '#2a3040',
    colorBorderSecondary: '#1e2433',
    colorText: '#e8eaf2',
    colorTextSecondary: '#9aa3b8',
    borderRadius: 10,
    fontSize: 14,
    controlHeight: 36,
  },
  components: {
    Card: { colorBgContainer: '#141824', paddingLG: 22 },
    Layout: { siderBg: '#0f121b', headerBg: 'rgba(11,13,20,0.85)', bodyBg: '#0b0d14' },
    Menu: { itemBg: 'transparent', itemSelectedBg: 'rgba(124,92,255,0.18)', itemSelectedColor: '#a68bff' },
    Table: { headerBg: '#181d2a' },
    Modal: { contentBg: '#161b28', headerBg: '#161b28' },
    Drawer: { colorBgElevated: '#12161f' },
    Segmented: { itemSelectedBg: '#262d40' },
  },
}

/** 浅色变体：同主色系、跟随 Doublog 亮色模式（antd 组件壳自动变浅；
 * 画布工作区内部为源设计的深色画布，不随此切换——见迁移报告已知取舍） */
export const lightTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#7c5cff',
    colorInfo: '#4096ff',
    colorSuccess: '#2ed573',
    colorWarning: '#ffb020',
    colorError: '#ff4d6a',
    borderRadius: 10,
    fontSize: 14,
    controlHeight: 36,
  },
  components: {
    Card: { paddingLG: 22 },
    Segmented: { itemSelectedBg: '#eef0f6' },
  },
}

/** 人物头像的确定性调色板（按 ID 哈希取用）：渐变双色 / MiniMap 纯色共用 */
const AVATAR_PALETTES = [
  ['#7c5cff', '#38b6ff'], ['#ff6b9d', '#ff9f43'], ['#2ed573', '#1e90ff'],
  ['#f368e0', '#845ef7'], ['#ffa502', '#ff6348'], ['#00d2d3', '#3d8bfd'],
  ['#5f27cd', '#341f97'], ['#ee5253', '#f368e0'],
]

/** 人物头像的确定性渐变色（按 ID 哈希） */
export function avatarGradient(id) {
  const [a, b] = AVATAR_PALETTES[id % AVATAR_PALETTES.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

/** 同一调色板的纯色版（MiniMap 等不支持渐变的地方用） */
export function avatarColor(id) {
  return AVATAR_PALETTES[id % AVATAR_PALETTES.length][0]
}

/** 阵营名 → 确定性纯色（同名阵营同色，用于徽章和分组着色） */
export function factionColor(name) {
  if (!name) return '#8b93a8'
  const colors = ['#f5915f', '#65a9ff', '#7ce0b3', '#e8a0ff', '#ffd666', '#ff8787', '#95de64', '#b5a8ff']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

/** 玻璃拟态卡片样式（Dashboard/关系配置/搜索页）。源版为常量；适配后随 Doublog 明暗
 * 给出对应变体（dark 保持源深空玻璃，light 为白玻璃）。用法 style={glassPanel(dark)} */
export function glassPanel(dark = true) {
  return dark
    ? {
        background: 'linear-gradient(160deg, rgba(26,31,46,.9), rgba(20,24,36,.92))',
        border: '1px solid #2a3040',
        borderRadius: 14,
        backdropFilter: 'blur(8px)',
      }
    : {
        background: 'linear-gradient(160deg, rgba(255,255,255,.94), rgba(255,255,255,.86))',
        border: '1px solid rgba(28,24,60,.10)',
        borderRadius: 14,
        backdropFilter: 'blur(8px)',
      }
}
