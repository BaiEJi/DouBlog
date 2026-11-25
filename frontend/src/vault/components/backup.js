function fields(source, keys) {
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
}

function cipherBox(raw) { return fields(raw, ['n', 'ct']) }

// Drop browser-only metadata and unknown file properties at the network boundary.
export function restorePayload(backup, expectedKey) {
  const account = fields(backup.account, ['kdf_algo', 'kdf_salt', 'recovery_salt'])
  const params = typeof backup.account.kdf_params === 'string' ? JSON.parse(backup.account.kdf_params) : backup.account.kdf_params
  account.kdf_params = fields(params, ['t', 'm', 'p'])
  for (const key of ['wrapped_vault_key', 'recovery_wrapped_vault_key']) account[key] = cipherBox(backup.account[key])
  if (backup.account.group_catalog != null) account.group_catalog = cipherBox(backup.account.group_catalog)
  return {
    format: backup.format, version: backup.version ?? 1, account, expected_key: expectedKey,
    items: backup.items.map(item => ({ ...fields(item, ['id', 'favorite', 'last_used_at', 'password_updated_at', 'deleted_at', 'created_at', 'updated_at']), blob: cipherBox(item.blob) })),
    attachments: (backup.attachments || []).map(file => ({ ...fields(file, ['item_id', 'size', 'created_at']), blob: cipherBox(file.blob) })),
  }
}
