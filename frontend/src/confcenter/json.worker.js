import { jsonErrorDetail } from './jsonTools.js'

self.onmessage = ({ data: { id, type, payload: { text, minify } } }) => {
  try {
    const value = JSON.parse(text)
    self.postMessage({ id, result: type === 'format' ? JSON.stringify(value, null, minify ? 0 : 2) : true })
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: jsonErrorDetail(text, error) } })
  }
}
