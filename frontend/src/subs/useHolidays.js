/**
 * 中国法定节假日/调休查询（CrownFlow 迁移）：timor.tech 年度 API，
 * localStorage 缓存 7 天，失败静默降级（仅按周末判定休息日）。
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const CACHE_KEY_PREFIX = 'doublog_subs_holidays_'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

const memCache = {}

function getCachedYear(year) {
  const raw = localStorage.getItem(CACHE_KEY_PREFIX + year)
  if (!raw) return null
  try {
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY_PREFIX + year)
      return null
    }
    return data
  } catch {
    return null
  }
}

export function useHolidays(year) {
  const targetYear = year ?? new Date().getFullYear()
  const [holidays, setHolidays] = useState({})
  const fetchedRef = useRef(new Set())

  const fetchYear = useCallback(async y => {
    if (memCache[y]) { setHolidays(prev => ({ ...prev, ...memCache[y] })); return }
    const cached = getCachedYear(y)
    if (cached) {
      memCache[y] = cached
      setHolidays(prev => ({ ...prev, ...cached }))
      return
    }
    try {
      const res = await fetch(`https://timor.tech/api/holiday/year/${y}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.code !== 0) throw new Error('API error')
      const mapped = {}
      for (const val of Object.values(json.holiday || {})) {
        mapped[val.date] = { date: val.date, name: val.name, holiday: val.holiday }
      }
      memCache[y] = mapped
      localStorage.setItem(CACHE_KEY_PREFIX + y, JSON.stringify({ data: mapped, ts: Date.now() }))
      setHolidays(prev => ({ ...prev, ...mapped }))
    } catch {
      // 静默降级：接口不可用时按周末判定（日历仍可用）
    }
  }, [])

  useEffect(() => {
    for (const y of [targetYear - 1, targetYear, targetYear + 1]) {
      if (!fetchedRef.current.has(y)) {
        fetchedRef.current.add(y)
        fetchYear(y)
      }
    }
  }, [targetYear, fetchYear])

  const getDayInfo = useCallback(date => {
    const d = new Date(date + 'T00:00:00')
    const dateStr = date
    const dow = d.getDay()
    const isWeekend = dow === 0 || dow === 6
    const info = holidays[dateStr]
    if (info) {
      return {
        isWeekend, isHoliday: !!info.holiday, isRestDay: !!info.holiday,
        holidayName: info.name,
      }
    }
    return { isWeekend, isHoliday: false, isRestDay: isWeekend, holidayName: undefined }
  }, [holidays])

  return { holidays, getDayInfo, fetchYear }
}
