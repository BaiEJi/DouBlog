import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfigDraft } from '../src/apihub/configDraft.js'

test('empty, null, malformed, and structurally invalid drafts never enter form controls', () => {
  for (const value of ['', 'null', '[]', '{"providers":[}', '{"providers":[null]}', '{"providers":"token"}', '{"credential_fields":"token"}']) {
    assert.throws(() => parseConfigDraft(value, 'auth'))
  }
  assert.throws(() => parseConfigDraft('{"expect_status":"200"}', 'probe'))
  assert.throws(() => parseConfigDraft('{"error_mapping":{"success_codes":"0"}}', 'response'))
})
test('valid advanced configuration preserves unknown fields and Unicode losslessly', () => {
  const source = { providers: [{ type: 'path_token' }], credential: {}, vendor: { '中文': [1, true] } }
  assert.deepEqual(parseConfigDraft(JSON.stringify(source), 'auth'), source)
})
