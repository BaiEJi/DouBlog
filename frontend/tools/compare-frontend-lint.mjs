import fs from 'node:fs'
import path from 'node:path'
import {ESLint} from 'eslint'
const baseline=process.argv[2]
if(!baseline)throw new Error('Pass immutable baseline repository directory')
const eslint=new ESLint(),directories=['src/shared','src/app','src/portal','src/config','src/vault','src/gamemap','src/devtoolbox']
const files=directories.flatMap(directory=>fs.readdirSync(directory,{recursive:true}).filter(file=>/\.(?:js|jsx)$/.test(file)).map(file=>path.join(directory,file)))
const moved={'src/shared/ui/kit.jsx':'src/todo/kit.jsx','src/shared/ui/charts.jsx':'src/todo/charts.jsx','src/shared/ui/icons.jsx':'src/todo/kit.jsx','src/shared/text.js':'src/devtoolbox/lib/text.js','src/shared/diff.js':'src/devtoolbox/lib/diff.js'}
const report={baseline,files:[],increased:[]}
for(const file of files){
 const previous=path.join(baseline,'frontend',moved[file.replaceAll('\\','/')]||file),old=fs.existsSync(previous)?fs.readFileSync(previous,'utf8'):''
 const [before]=await eslint.lintText(old,{filePath:file}),[after]=await eslint.lintText(fs.readFileSync(file,'utf8'),{filePath:file})
 const count=result=>result.messages.reduce((counts,m)=>{const key=`${m.severity}:${m.ruleId||'parse'}`;counts[key]=(counts[key]||0)+1;return counts},{})
 const prior=count(before),current=count(after),increased=Object.keys(current).filter(key=>current[key]>(prior[key]||0))
 report.files.push({file,before:prior,after:current})
 if(increased.length)report.increased.push({file,rules:increased,messages:after.messages.filter(m=>increased.includes(`${m.severity}:${m.ruleId||'parse'}`)).map(({ruleId,line,message})=>({ruleId,line,message:message.split('\n')[0]}))})
}
const output=path.resolve('../.ui-qa/optimization/frontend-lint-comparison.json')
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({files:files.length,increased:report.increased,output},null,2));process.exitCode=report.increased.length?1:0
