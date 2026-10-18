/**
 * Digital Vault 核心模块：数据模型常量、密码/口令短语生成器、熵与强度评估、
 * Identity 关系提取、安全分析、密码历史辅助。
 * 独立于 UI 与网络，未来多客户端复用。
 */

// ─── 常量 ────────────────────────────────────────────────
export const ITEM_TYPES = ['Website', 'App', 'Email', 'Social', 'Developer', 'Server', 'Finance', 'Work', 'Other']
export const CATEGORIES = ['Social', 'Developer', 'Work', 'Finance', 'Shopping', 'Entertainment', 'Email', 'Server', 'Other']
export const SECRET_KINDS = [
  { key: '2fa_secret', label: '2FA Secret', secret: true },
  { key: 'backup_code', label: 'Backup Code', secret: true },
  { key: 'pin', label: 'PIN', secret: true },
  { key: 'api_key', label: 'API Key', secret: true },
  { key: 'recovery_key', label: 'Recovery Key', secret: true },
  { key: 'security_question', label: 'Security Question', secret: true },
]
export const LOGIN_METHODS = ['Password', 'Passkey', 'OAuth', 'Phone SMS', 'QR Code']

// 展示层中文映射（存储值保持英文枚举，改翻译不用动数据）
export const TYPE_LABELS = {
  Website: '网站', App: '应用', Email: '邮箱', Social: '社交', Developer: '开发',
  Server: '服务器', Finance: '金融', Work: '工作', Other: '其他',
}
export const CATEGORY_LABELS = {
  Social: '社交', Developer: '开发', Work: '工作', Finance: '金融', Shopping: '购物',
  Entertainment: '娱乐', Email: '邮箱', Server: '服务器', Other: '其他',
}
export const SECRET_KIND_LABELS = {
  '2fa_secret': '两步验证密钥', backup_code: '备份码', pin: 'PIN 码',
  api_key: 'API Key', recovery_key: '恢复密钥', security_question: '安全问题',
}
export const METHOD_LABELS = {
  Password: '密码', Passkey: '通行密钥', OAuth: '第三方登录',
  'Phone SMS': '短信验证', 'QR Code': '扫码登录',
}

export function emptyItem() {
  return {
    v: 1,
    service: '',
    type: 'Website',
    category: 'Other',
    urls: [],
    app_name: '',
    username: '',
    password: { value: '' },
    password_updated_at: null,
    expiry_days: null,    // 到期提醒周期（天）：密码 N 天未改后在概览/安全中心提醒；null=不提醒
    password_history: [],
    account_id: '',
    phone: '',             // 手机号（可选）
    email: '',             // 邮箱（可选）
    real_name: '',         // 实名人（可选）
    identities: [],       // { type:'email'|'phone', value, role:'primary'|'recovery' }
    login_methods: [],
    secrets: [],          // { kind, question?, value }
    custom_fields: [],    // { key, value, secret }
    notes: '',
    tags: [],
  }
}

// ─── 生成器（无偏随机：拒绝采样，无 modulo 偏差）────────
function randomInt(maxExclusive) {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  let v
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % maxExclusive
}

const CHARSETS = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
}
// 默认字符集不含易混淆字符（I l O 0 1）；含上/l/O/0/1 的完整集：
const FULL_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const FULL_LOWER = 'abcdefghijklmnopqrstuvwxyz'
const FULL_NUM = '0123456789'

/**
 * 生成随机密码
 * @param {object} opts { length(8-128), uppercase, lowercase, numbers, symbols, includeAmbiguous }
 */
export function generatePassword(opts = {}) {
  const length = Math.max(8, Math.min(128, opts.length || 20))
  const pools = []
  const chars = []
  const use = (set, enabled, fallback) => {
    if (enabled) {
      pools.push(set)
      chars.push(set[randomInt(set.length)])
    }
  }
  use(opts.includeAmbiguous ? FULL_UPPER : CHARSETS.uppercase, opts.uppercase !== false)
  use(opts.includeAmbiguous ? FULL_LOWER : CHARSETS.lowercase, opts.lowercase !== false)
  use(opts.includeAmbiguous ? FULL_NUM : CHARSETS.numbers, opts.numbers !== false)
  use(CHARSETS.symbols, opts.symbols !== false)
  if (!pools.length) {
    pools.push(FULL_LOWER)
    chars.push(FULL_LOWER[randomInt(FULL_LOWER.length)])
  }
  const all = pools.join('')
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  // 洗牌（Fisher-Yates，随机源同上）
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.slice(0, length).join('')
}

// 词表（1004 个常用词，EFF 风格；每个词 ≈ log2(1004) ≈ 10 bit 熵）
export const PASSPHRASE_WORDS = ('able acid acorn acre actor adobe adult agent album alert alley almond alpha amber amble anchor angle ankle apple april arbor arcade arch arctic argon armor arrow ashen Aspen atom attic audio august aura auto avenue awake axis bacon badge bagel baker balmy banana banjo barge basil batch beach beacon beam bean bear beast bench berry bicycle bishop bison black blade blaze bloom blue bluff boat bonus book booth borrow bottle boulder brave bread brick bridge bright bronze brook brush bubble bucket buffalo bugle builder bundle burrow butter cabin cactus camel canal candle canoe canopy canvas canyon carbon cargo carol castle cattle cedar cellar cereal chalk charm cheese cherry chess chili chimney chorus cider cinema circle citrus clarion clay clever cliff cloak clover club coast cobra cocoa comet compass concert copper coral cosmos cotton cougar course cover coyote craft crane crater cream creek crest cricket crimson crisp crown cube cumin curve cyclone dahlia daisy dance dapper dawn debut decoy deer delta demo denim depot desert diagram diesel dime diner dingo dish dive dock doge dolphin domain donkey donor dough dove dragon drawer drift drum dune dusk eagle early earth easel echo eclipse edge eight elbow elder electric elite ember emerald empire energy engine enigma entry envoy equal era essay ethic evening exact exile fable fairy false fancy fathom feather fedora feline fence fern ferry fiber fiddle field fig filter finch fire fish flag flare flask fleet flint float flock flora flour flute focus foggy forest forge fossil found fox fresh frost fudge fuel funny gadget galaxy gallon garden garlic gauge gecko gem general genius gentle genuine ghost giant gift ginger giraffe glacier glance glass glaze glean glide globe gloss glove goblet golden gopher gorge gospel gouda grace grain granite grape gravel green grill grove guard guitar gulf gully gumbo gusto gypsum habitat hairy halo hamlet hammer harbor harvest hatch haven hazel heart hedge helium helmet herb hermit hero hickory hidden hollow honey honor hood hornet horse hotel humble hunter hurdle hybrid iceberg icicle idea igloo image impact inch index indigo ingot inlet insect invest invite iris iron island ivory jacket jade jaguar jasmine jelly jewel jockey jolly joyful judge juggle juice jumbo jungle juniper jury kabob kayak kernel kettle keyhole khaki kiln kind king kiosk kitten kiwi knack knife koala lagoon lantern lapis larch large larva lasso latch laurel lava lawn layer leafer legend lemon lentil level lever liberty lichen lilac limber lime linen lion liquid liter llama lobby lobster locket lodge loft logic lotus lumber lunar lynx lyric macaw magic magnet mahogany maize major mango manor maple marble march marsh mascot mason meadow medal melody memory mentor mercy mesa metal meteor middle mild mint mirror mist mitten mocha modem molar moment monarch monsoon moose morning mosaic moss motel motor mound mountain mule mushroom music mustard nacho narrow nation nature nautical navy near neat nebula nectar needle nerve nest never newt niche nickel night nimble noble nomad noodle north notch novel nozzle nugget nutmeg oasis oat ocean octave odyssey offer olive omega onion onyx opal opera orange orbit orchid organ origin osprey otter outback outer oval owl oxide oyster pact paddle pagoda palace pallet panda pantry papaya parlor parsley pasture patio pattern peach pebble pecan pedal pelican pencil penguin pepper perch period petal phantom phoenix piano picnic pigment pilot pine pioneer pistol pivot pixel pizza place plank plasma plaza pledge plum plush pocket poem polar pollen pond poppy porch port possum potato pouch powder prairie prance present prism prize profile prompt prose prosper proud prune pulley pulse pupil pyramid quality quarry quartz quest quiet quilt quiver quota rabbit raccoon radar radish raft rail rain rally ranch rapid rascal raven razor ready realm rebel recap redwood reef regal relay remedy render rescue resin retro reveal rhino ribbon ridge rifle rigid rinse ripple rising ritual river road roast robin robot rocket rodeo rogue roman rooster rose rotate rough round route royal rubble rugby ruler rumor rustic saddle safari saffron sage sailor salmon salute sand sapphire sardine satin savage savory scale scenic school scoop scope score scout scrap screen script scroll sculpt seal season second sedan seed select sequel serene serum settle shadow shale shape share shark shawl shear sheen shelf shell shelter sherry shield shifter shine shirt shoal shore shovel shrimp shrine sierra siesta sigma silence silica silk silver simple siren sixteen sketch skillet sky slate sleek sleep slice slide slope small smart smile smoke snack snail snake snow social socket sodium solar solid sonar sonnet sorbet sound source south space spade spark spatula spice spider spinach spiral splash spoke sponge spool spore spring sprout spruce squad square squash stable stadium stage stamp stand star state static statue steam steel stem step stereo stick stitch stock stone storage storm story stove strand straw stream street strike strong studio study stump sturdy style sugar suite sulfur summer summit sunset super supply surf sweet swift swing switch sword symbol syrup table tackle tadpole tailor talent tandem tangelo tank tapest target tavern teak tempo tender tennis terrace texture thank theme thicket thimble thistle thorn thread thrive throne thunder ticket tidal tiger timber timely tinder tinsel titan toast tobacco toffee token tomato tonic topaz torch tortoise total totem toucan tower trace track trailer trait tram trap travel trays treat trend trial tribe trick trident tripod trophy trout truck truffle trumpet trunk trust truth tulip tumble tundra tunnel turbo turtle tusk tutor tweed twelve twilight twist ultra umber umpire under unify union unique unit update uplift upper upright upward urban useful usher utensil utmost vacant vagrant valley valor value vanilla vapor varnish vault vector velvet vendor venture verbal verify vessel vibrant video vigil vigor villa vine vintage violet violin virtue visit vista vital vivid vocal volcano voltage voyage waffle wagon walnut walrus wander warble warden warm wasabi watch water wattle wave waxy weaver wedge welcome whisper wicker widget wild willow window winner winter wisdom wizard wolf wonder woodland wool worthy wrestle xenon xerox yacht yarn year yeast yellow yield yodel yoga yogurt young zebra zenith zephyr zest zigzag zipper zodiac zone').split(/\s+/).filter(Boolean)

/**
 * 生成口令短语（默认 correct-horse-battery-staple 风格）
 * @param {object} opts { words(3-10), separator, capitalize, includeNumber }
 */
export function generatePassphrase(opts = {}) {
  const count = Math.max(3, Math.min(10, opts.words || 4))
  const sep = opts.separator || '-'
  let words = []
  for (let i = 0; i < count; i++) {
    let w = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1)
    words.push(w)
  }
  if (opts.includeNumber) words[randomInt(words.length)] += String(randomInt(100))
  return words.join(sep)
}

// ─── 熵与强度 ────────────────────────────────────────────
/** 字符集估算熵：len × log2(pool) */
export function passwordEntropy(pw) {
  if (!pw) return 0
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/[0-9]/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33
  if (pool === 0) pool = 10
  return Math.round(pw.length * Math.log2(pool))
}

export function passphraseEntropy(pp, wordCount) {
  const bits = Math.log2(PASSPHRASE_WORDS.length)
  return Math.round((wordCount || (pp.match(/[-\s]/g) || []).length + 1) * bits)
}

/** 强度标签（客户端估算，用于展示与弱密码检测） */
export function strengthLabel(entropy) {
  if (entropy < 40) return { label: '弱', color: '#dc2626' }
  if (entropy < 60) return { label: '一般', color: '#d97706' }
  if (entropy < 80) return { label: '强', color: '#16a34a' }
  return { label: '很强', color: '#15803d' }
}

// ─── Identity 关系 ───────────────────────────────────────
/**
 * 从解密后的条目提取 Identity → 分组
 * @returns {Array<{type, value, role, items: itemId[]}>}
 */
export function extractIdentities(items) {
  const map = new Map()
  for (const it of items) {
    for (const id of (it.data.identities || [])) {
      if (!id.value) continue
      const key = `${id.type}:${id.value.toLowerCase()}`
      if (!map.has(key)) map.set(key, { type: id.type, value: id.value, count: 0, itemIds: [] })
      const entry = map.get(key)
      entry.count++
      entry.itemIds.push(it.id)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export function maskIdentity(value, type) {
  if (!value) return ''
  if (type === 'email') {
    const [name, domain] = value.split('@')
    if (!domain) return value.slice(0, 2) + '***'
    return (name?.slice(0, 2) || '') + '***@' + domain
  }
  return value.slice(0, 3) + '****' + value.slice(-2)
}

// ─── 安全分析（全部客户端，基于解密数据）────────────────
export const OLD_PASSWORD_DAYS = 180

/**
 * @param {Array} items 解密后的条目 [{id, data, favorite, last_used_at, password_updated_at, deleted_at}]
 * @returns {weak, reused, old, expired, no2fa, duplicate, missingRecovery}（expired = 超过自定义到期周期的条目）
 */
export function analyzeSecurity(items) {
  const live = items.filter(i => !i.deleted_at)

  const weak = live.filter(i => i.data.password?.value && passwordEntropy(i.data.password.value) < 60)

  const byPassword = new Map()
  for (const i of live) {
    const pw = i.data.password?.value
    if (!pw) continue
    if (!byPassword.has(pw)) byPassword.set(pw, [])
    byPassword.get(pw).push(i)
  }
  const reused = [...byPassword.entries()].filter(([, arr]) => arr.length > 1)
    .map(([pw, arr]) => ({ hash: pw.slice(0, 3) + '…', size: pw.length, items: arr }))

  const now = Date.now()
  const old = live.filter(i => {
    const t = i.password_updated_at || i.data.password_updated_at || i.created_at
    if (!t) return false
    return (now - new Date(t).getTime()) > OLD_PASSWORD_DAYS * 86400000
  })

  const expired = live.filter(i => expiryInfo(i) !== null)

  const no2fa = live.filter(i => {
    const has2faSecret = (i.data.secrets || []).some(s => s.kind === '2fa_secret' && s.value)
    const hasPasskey = (i.data.login_methods || []).some(m => /passkey/i.test(m))
    return i.data.password?.value && !has2faSecret && !hasPasskey
  })

  const dupMap = new Map()
  for (const i of live) {
    const key = `${(i.data.service || '').toLowerCase().trim()}|${(i.data.username || '').toLowerCase().trim()}`
    if (!i.data.service) continue
    if (!dupMap.has(key)) dupMap.set(key, [])
    dupMap.get(key).push(i)
  }
  const duplicate = [...dupMap.values()].filter(arr => arr.length > 1)

  const missingRecovery = live.filter(i => {
    const ids = i.data.identities || []
    const hasRecoveryEmail = ids.some(x => x.type === 'email' && x.role === 'recovery')
    const hasRecoveryPhone = ids.some(x => x.type === 'phone' && x.role === 'recovery')
    const hasRecoverySecret = (i.data.secrets || []).some(s => s.value && ['recovery_key', 'backup_code'].includes(s.kind))
    return !hasRecoveryEmail && !hasRecoveryPhone && !hasRecoverySecret
  })

  return { weak, reused, old, expired, no2fa, duplicate, missingRecovery }
}

/**
 * 条目密码是否已超过自定义到期周期（expiry_days）。
 * @returns {null | {days:number, limit:number}} 超期时返回 已过天数 与 设定周期
 */
export function expiryInfo(item) {
  const raw = item.data?.expiry_days
  if (raw === null || raw === undefined || raw === '') return null
  const limit = Number(raw)
  if (!Number.isFinite(limit) || limit < 0) return null
  const t = item.password_updated_at || item.data?.password_updated_at || item.created_at
  if (!t) return null
  const days = Math.floor((Date.now() - new Date(t).getTime()) / 86400000)
  return days >= limit ? { days, limit } : null
}

// ─── 密码历史 ────────────────────────────────────────────
/**
 * 修改密码时推进历史：当前密码进入 history（replacedAt=now），新密码带 createdAt
 * @returns {boolean} 是否真的发生了密码变化
 */
export function applyPasswordChange(item, newPassword, reason) {
  const old = item.password?.value
  if (old === newPassword) return false
  const now = new Date().toISOString()
  if (old) {
    item.password_history = item.password_history || []
    const last = item.password_history[item.password_history.length - 1]
    // 当前密码若无历史起点，用 password_updated_at 或条目创建时间补 createdAt
    item.password_history.push({
      value: old,
      createdAt: item.password_updated_at || last?.replacedAt || now,
      replacedAt: now,
      reason: reason || '',
    })
  }
  item.password = { value: newPassword }
  item.password_updated_at = now
  return true
}

/** 历史条目使用时长（天） */
export function usageDays(entry) {
  const start = new Date(entry.createdAt).getTime()
  const end = entry.replacedAt ? new Date(entry.replacedAt).getTime() : Date.now()
  return Math.max(1, Math.round((end - start) / 86400000))
}

// ─── 搜索 ────────────────────────────────────────────────
/** 条目匹配：服务名/用户名/邮箱/手机/域名/标签/Account ID */
export function itemMatches(item, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const d = item.data
  const haystack = [
    d.service, d.username, d.account_id, d.app_name, d.phone, d.email, d.real_name,
    ...(d.tags || []),
    ...(d.urls || []).map(u => u.value),
    ...(d.identities || []).map(i => i.value),
  ].filter(Boolean).join(' ').toLowerCase()
  return q.split(/\s+/).every(tok => haystack.includes(tok))
}

/** 从 URL 提取域名 */
export function domainOf(url) {
  if (!url) return ''
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

export function daysAgo(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}
