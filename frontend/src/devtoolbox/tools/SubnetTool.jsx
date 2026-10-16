/** IPv4 子网计算：CIDR → 网络地址/广播/掩码/可用主机范围/类别判断；附带 IP 转二进制与八进制/十六进制 */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, inputCls, card } from '../kit'

const ipToInt = ip => ip.trim().split('.').reduce((n, o) => (n << 8) + (+o), 0) >>> 0
const intToIp = n => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')
const isValidIp = ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim()) && ip.trim().split('.').every(o => +o <= 255)

function classify(network) {
  const first = network >>> 24
  if (network === 0) return '本网络（0.0.0.0/8）'
  if (first === 10) return '私有 A 类（10.0.0.0/8）'
  if (first === 127) return '环回（127.0.0.0/8）'
  if (first === 169 && (network >>> 16 & 255) === 254) return '链路本地（169.254.0.0/16）'
  if (first === 172 && (network >>> 16 & 255) >= 16 && (network >>> 16 & 255) <= 31) return '私有 B 类（172.16.0.0/12）'
  if (first === 192 && (network >>> 16 & 255) === 168) return '私有 C 类（192.168.0.0/16）'
  if (first >= 224 && first <= 239) return '组播（D 类）'
  if (first >= 240) return '保留（E 类）'
  return '公网单播'
}

export default function SubnetTool() {
  const [input, setInput] = useState('192.168.10.130/26')

  const result = useMemo(() => {
    const s = input.trim()
    if (!s) return null
    const m = s.match(/^(.+?)(?:\/(\d{1,2}))?$/)
    const ip = m?.[1]
    const prefix = m?.[2] != null ? +m[2] : 24
    if (!isValidIp(ip)) return { error: '无效 IPv4 地址' }
    if (prefix > 32) return { error: '前缀长度 0-32' }
    const ipInt = ipToInt(ip)
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    const network = (ipInt & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const total = 2 ** (32 - prefix)
    const usable = Math.max(0, total - 2)
    const firstHost = usable ? intToIp(network + 1) : '—'
    const lastHost = usable ? intToIp(broadcast - 1) : '—'
    return {
      ip, prefix, mask: intToIp(mask), network, broadcast: intToIp(broadcast),
      networkIp: intToIp(network), wildcard: intToIp(~mask >>> 0),
      total, usable, firstHost, lastHost,
      type: classify(network),
      binary: ipInt.toString(2).padStart(32, '0').replace(/(.{8})(?=.)/g, '$1 '),
      hex: '0x' + ipInt.toString(16).padStart(8, '0').toUpperCase(),
      octal: '0o' + ipInt.toString(8),
    }
  }, [input])

  return (
    <div>
      <ToolHead title="IPv4 子网计算" desc="CIDR 拆解：网络地址 / 广播地址 / 掩码 / 可用主机范围 / 公私网判断" />
      <input className={inputCls + ' w-full font-mono'} value={input} spellCheck={false}
        onChange={e => setInput(e.target.value)} placeholder="192.168.1.10/24（省略 /24 时按 /24 计）" aria-label="CIDR 输入" />
      <div className="mt-2"><StatusLine ok={!!result?.ip} err={result?.error || (input.trim() && !result ? '输入无效' : null)} okText="解析成功" /></div>
      {result?.ip && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className={'divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
            {[
              ['IP 地址', result.ip],
              ['前缀长度', `/${result.prefix}`],
              ['子网掩码', result.mask],
              ['反掩码 wildcard', result.wildcard],
              ['网络地址', result.networkIp],
              ['广播地址', result.broadcast],
              ['首个可用主机', result.firstHost],
              ['最后可用主机', result.lastHost],
              ['地址总数', result.total.toLocaleString()],
              ['可用主机数', result.usable > 0 ? result.usable.toLocaleString() : '0（/31 与 /32 无主机地址）'],
              ['网段类型', result.type],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 px-4 py-2">
                <span className="w-28 shrink-0 text-xs text-stone-500 dark:text-stone-400">{k}</span>
                <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{v}</code>
                <CopyBtn text={String(v)} />
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className={card + ' p-4'}>
              <p className="text-sm font-semibold mb-2">地址区间</p>
              <div className="h-9 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] relative overflow-hidden">
                <div className="absolute inset-y-0 bg-lime-500/30 dark:bg-lime-400/25" style={{ left: 0, right: 0 }} />
                <div className="absolute inset-0 flex items-center justify-between px-3 font-mono text-[11.5px] text-stone-600 dark:text-stone-300">
                  <span>{result.networkIp}</span>
                  <span>{result.broadcast}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">两端为网络/广播地址{result.usable > 0 ? '，中间为可用主机' : ''}</p>
            </div>
            <div className={card + ' p-4'}>
              <p className="text-sm font-semibold mb-2">IP 其他进制</p>
              <div className="space-y-1.5 font-mono text-[12.5px]">
                <p className="break-all"><span className="text-stone-400 mr-2">BIN</span>{result.binary}</p>
                <p><span className="text-stone-400 mr-2">HEX</span>{result.hex}</p>
                <p><span className="text-stone-400 mr-2">OCT</span>{result.octal}</p>
                <p><span className="text-stone-400 mr-2">DEC</span>{result.network >>> 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
