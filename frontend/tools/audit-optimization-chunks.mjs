import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {gzipSync} from 'node:zlib'
import {build} from 'vite'
const baseline=path.resolve(process.argv[2]||'../.ui-qa/optimization/baseline-75d4295eac1446b98e707d170bf89440/frontend')
const beforeDist=path.resolve('../.ui-qa/optimization/baseline-final-frontend-dist'),afterDist=path.resolve('dist')
const hash=data=>createHash('sha256').update(data).digest('hex')
const inputFiles=['package-lock.json','src/mindmap/adapter.js','src/shared/md.js','vite.config.js','tools/audit-optimization-chunks.mjs']
const hashes=async()=>Object.fromEntries(await Promise.all(inputFiles.map(async file=>[file,hash(await fs.readFile(file))])))
const startHashes=await hashes()
async function summarize(dist){
 const manifest=JSON.parse(await fs.readFile(path.join(dist,'.vite/manifest.json'),'utf8')),files=await fs.readdir(path.join(dist,'assets'))
 const chunks=await Promise.all(files.filter(file=>file.endsWith('.js')).map(async file=>{const bytes=await fs.readFile(path.join(dist,'assets',file));return{file:'assets/'+file,bytes:bytes.length,gzipBytes:gzipSync(bytes).length,sha256:hash(bytes)}}))
 const records=new Map(Object.entries(manifest).map(([key,value])=>[key,value])),byFile=new Map(chunks.map(chunk=>[chunk.file,chunk]))
 function closure(keys,dynamic=false){const visited=new Set(),pending=[...keys],out=new Set();while(pending.length){const key=pending.pop();if(visited.has(key))continue;visited.add(key);const record=records.get(key);if(!record)continue;if(byFile.has(record.file))out.add(record.file);pending.push(...record.imports||[]);if(dynamic)pending.push(...record.dynamicImports||[])}return[...out]}
 const bytesFor=list=>list.reduce((s,file)=>({bytes:s.bytes+(byFile.get(file)?.bytes||0),gzipBytes:s.gzipBytes+(byFile.get(file)?.gzipBytes||0)}),{bytes:0,gzipBytes:0})
 const entries=Object.entries(manifest).filter(([,v])=>v.isEntry).map(([key,v])=>{const staticFiles=closure([key]);return{key,file:v.file,staticFiles,...bytesFor(staticFiles)}})
 const initial=new Set(entries.flatMap(entry=>entry.staticFiles))
 const routePatterns={vault:/src\/vault\/VaultPage/,gamemap:/src\/gamemap\/pages\/GameWorkspace/,mindmap:/src\/mindmap\/adapter/,markdown:/^_md-.*\.js$/,portal:/src\/portal\/PortalPage/}
 const routes=Object.fromEntries(Object.entries(routePatterns).map(([name,pattern])=>{const roots=Object.keys(manifest).filter(key=>pattern.test(key)),staticFiles=closure(roots),additional=staticFiles.filter(file=>!initial.has(file)),cold=[...new Set([...initial,...staticFiles])];return[name,{roots,staticFiles,...bytesFor(staticFiles),additionalBeyondEntry:{files:additional,...bytesFor(additional)},coldEntryAndRoute:{files:cold,...bytesFor(cold)}}]}))
 return{dist,total:{chunks:chunks.length,...bytesFor(chunks.map(chunk=>chunk.file))},entries,routes,largest:[...chunks].sort((a,b)=>b.bytes-a.bytes).slice(0,10),chunks}
}
const [before,after]=await Promise.all([summarize(beforeDist),summarize(afterDist)])
// Generate production output in memory to inspect actual rendered module IDs,
// not package names in node_modules or strings in comments. This adds no code.
const generated=await build({configFile:path.resolve('vite.config.js'),logLevel:'error',build:{write:false,manifest:true}})
const outputs=(Array.isArray(generated)?generated:[generated]).flatMap(result=>result.output),chunks=outputs.filter(item=>item.type==='chunk')
const byName=new Map(chunks.map(chunk=>[chunk.fileName,chunk])),reachable=new Set(),pending=chunks.filter(chunk=>chunk.isEntry).map(chunk=>chunk.fileName)
while(pending.length){const name=pending.pop();if(reachable.has(name))continue;reachable.add(name);const chunk=byName.get(name);if(chunk)pending.push(...chunk.imports,...chunk.dynamicImports)}
const normalized=id=>id.replaceAll('\\','/')
const targets={quill:/\/node_modules\/quill\//,richText:/\/simple-mind-map\/src\/plugins\/RichText\.js/,formula:/\/simple-mind-map\/src\/plugins\/Formula\.js/,mindmapKatex:/\/simple-mind-map\/node_modules\/katex\//}
const targetProof=Object.fromEntries(Object.entries(targets).map(([name,pattern])=>[name,{rendered:chunks.filter(chunk=>chunk.moduleIds.some(id=>pattern.test(normalized(id)))).map(chunk=>({file:chunk.fileName,reachable:reachable.has(chunk.fileName),modules:chunk.moduleIds.filter(id=>pattern.test(normalized(id))).map(normalized)}))}]))
const diskChunkAgreement=await Promise.all(chunks.map(async chunk=>({file:chunk.fileName,matches:hash(await fs.readFile(path.join(afterDist,chunk.fileName)))===hash(chunk.code)})))
const editorChunks=chunks.filter(chunk=>chunk.moduleIds.some(id=>/\/node_modules\/(?:@codemirror|@lezer)\//.test(normalized(id)))).map(chunk=>({file:chunk.fileName,bytes:Buffer.byteLength(chunk.code),gzipBytes:gzipSync(chunk.code).length}))
const activeKatex=chunks.flatMap(chunk=>chunk.moduleIds.filter(id=>/\/node_modules\/katex\//.test(normalized(id))).map(id=>({file:chunk.fileName,id:normalized(id)})))
const adapterModules=chunks.flatMap(chunk=>chunk.moduleIds.filter(id=>/\/simple-mind-map\/src\/plugins\//.test(normalized(id))).map(normalized))
const vendorRequire=createRequire(path.resolve('node_modules/simple-mind-map/package.json'))
const installed={}
for(const name of['quill','katex']){try{const file=vendorRequire.resolve(name+'/package.json'),data=JSON.parse(await fs.readFile(file,'utf8'));installed[name]={version:data.version,path:file}}catch{installed[name]=null}}
const katexVersion=JSON.parse(await fs.readFile('node_modules/katex/package.json','utf8')).version
const endHashes=await hashes(),unchanged=JSON.stringify(startHashes)===JSON.stringify(endHashes)
const moduleProof={compiledChunks:chunks.length,reachableChunks:reachable.size,renderedModuleCount:new Set(chunks.flatMap(chunk=>chunk.moduleIds)).size,targets:targetProof,normalProductionFilesMatch:diskChunkAgreement.every(chunk=>chunk.matches),diskChunkAgreement,editorChunks,editorChunkTotals:editorChunks.reduce((sum,chunk)=>({bytes:sum.bytes+chunk.bytes,gzipBytes:sum.gzipBytes+chunk.gzipBytes}),{bytes:0,gzipBytes:0}),activeKatex:{version:katexVersion,modules:activeKatex},registeredVendorPluginModules:[...new Set(adapterModules)].sort(),installedFromMindmap:installed}
const result={finishedAt:new Date().toISOString(),method:'Two independent production builds: immutable baseline source with original installed lock/Vite versus current source/lock. gzip is per JS file (Node default level), total includes lazy/worker chunks and is not first-page transfer. Static closures exclude dynamic imports. Current in-memory production build records actual rendered module IDs and walks static+dynamic entry imports.',sourceHashes:startHashes,endSourceHashes:endHashes,sourcesUnchanged:unchanged,baselineLockSha256:hash(await fs.readFile(path.join(baseline,'package-lock.json'))),before,after,moduleProof}
const output=path.resolve('../.ui-qa/optimization/frontend-bundle-comparison.json');await fs.writeFile(output,JSON.stringify(result,null,2))
console.log(JSON.stringify({output,beforeTotal:before.total,afterTotal:after.total,beforeEntry:before.entries,afterEntry:after.entries,targets:targetProof,activeKatexVersion:katexVersion,sourcesUnchanged:unchanged},null,2))
assert.ok(unchanged,'source changed during chunk audit; repeat against frozen source')
assert.ok(moduleProof.normalProductionFilesMatch,'module evidence must match the ordinary production build byte for byte')
assert.ok(Object.values(targetProof).every(target=>target.rendered.length===0),'An excluded mindmap plugin or its dependency entered the generated bundle')
