/**
 * 天气/位置获取（纯前端，open-meteo 免费无 key；用户点按钮才请求定位权限）。
 * 位置内容不外发：只把经纬度发给天气 API 换天气；地名用浏览器自带的反向地理编码（离线则留空）。
 */
export async function fetchWeather() {
  if (!navigator.geolocation) return null
  const pos = await new Promise(resolve =>
    navigator.geolocation.getCurrentPosition(p => resolve(p), () => resolve(null),
      { timeout: 6000, maximumAge: 600000 }))
  if (!pos) return null
  const { latitude: lat, longitude: lon } = pos.coords
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current_weather=true`)
    const d = await r.json()
    const cw = d.current_weather || {}
    const weather = {
      temp: cw.temperature,
      code: cw.weathercode,
      wind: cw.windspeed,
    }
    return { weather, location: { lat: +lat.toFixed(3), lon: +lon.toFixed(3) } }
  } catch {
    return null
  }
}
