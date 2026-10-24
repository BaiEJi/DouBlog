export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep incomplete or structurally invalid drafts out of the structured controls. */
export function parseConfigDraft(text, kind) {
  if (!text.trim()) throw new Error('配置不能为空，请输入 JSON 对象')
  const value = JSON.parse(text)
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')
  const objectFields = kind === 'auth'
    ? ['credential', 'transport']
    : kind === 'request' ? ['body', 'param_defaults', 'query_defaults', 'header_defaults']
      : kind === 'response' ? ['error_mapping'] : ['headers']
  for (const key of objectFields) if (value[key] != null && !isRecord(value[key])) throw new Error(`${key} 必须是对象`)
  if (kind === 'auth') {
    if (value.providers != null && (!Array.isArray(value.providers) || !value.providers.every(provider => isRecord(provider) && typeof provider.type === 'string'))) {
      throw new Error('providers 必须是 provider 对象数组')
    }
    if (value.credential_fields != null && (!Array.isArray(value.credential_fields) || !value.credential_fields.every(field => typeof field === 'string'))) {
      throw new Error('credential_fields 必须是字符串数组')
    }
  }
  if (kind === 'response' && value.error_mapping?.success_codes != null && !Array.isArray(value.error_mapping.success_codes)) throw new Error('success_codes 必须是数组')
  if (kind === 'probe' && value.expect_status != null && !Array.isArray(value.expect_status)) throw new Error('expect_status 必须是数组')
  return value
}
