import fs from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'

const baseline = process.argv[2]
if (!baseline) throw new Error('Pass immutable baseline repository directory')
const eslint = new ESLint()
const directories = ['src/blog', 'src/todo', 'src/practice', 'src/subs']
const files = directories.flatMap(directory => fs.readdirSync(directory, { recursive: true })
  .filter(file => /\.(?:js|jsx)$/.test(file)).map(file => path.join(directory, file)))
const report = { baseline, files: [], increased: [] }
for (const file of files) {
  const previous = path.join(baseline, 'frontend', file)
  const oldText = fs.existsSync(previous) ? fs.readFileSync(previous, 'utf8') : ''
  const [before] = await eslint.lintText(oldText, { filePath: file })
  const [after] = await eslint.lintText(fs.readFileSync(file, 'utf8'), { filePath: file })
  const count = result => result.messages.reduce((counts, message) => {
    const key = `${message.severity}:${message.ruleId || 'parse'}`
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const prior = count(before), current = count(after)
  const increased = Object.keys(current).filter(key => current[key] > (prior[key] || 0))
  report.files.push({ file, before: prior, after: current })
  if (increased.length) report.increased.push({ file, rules: increased,
    messages: after.messages.filter(message => increased.includes(`${message.severity}:${message.ruleId || 'parse'}`))
      .map(({ ruleId, line, message }) => ({ ruleId, line, message: message.split('\n')[0] })) })
}
const output = path.resolve('../.ui-qa/optimization/knowledge-lint-comparison.json')
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ files: files.length, increased: report.increased, output }, null, 2))
process.exitCode = report.increased.length ? 1 : 0
