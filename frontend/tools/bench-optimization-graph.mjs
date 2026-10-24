import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
const smoke=process.argv.includes('--smoke'),outDir=path.resolve('../.ui-qa/optimization/graph-bench-dist')
const sourceFiles=['src/gamemap/board/shared.jsx','src/gamemap/board/geometry.js','src/gamemap/board/canvas.css','src/index.css','tools/optimization-edge-before.jsx','tools/optimization-graph.jsx','tools/optimization-graph.html','tools/bench-optimization-graph.mjs','package-lock.json','vite.config.js']
const hash=contents=>createHash('sha256').update(contents).digest('hex')
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await fs.readFile(file))])))}
const baselinePath='../.ui-qa/optimization/baseline-75d4295eac1446b98e707d170bf89440/frontend/src/gamemap/board/shared.jsx'
const baselineBytes=await fs.readFile(baselinePath),baselineSource=baselineBytes.toString().replace(/\r\n/g,'\n')
const marker='/** 求中心连线与节点矩形的交点（返回靠近中心的边界点） */',start=baselineSource.indexOf(marker)
assert.ok(start>=0,'baseline extraction marker must exist')
const extracted=baselineSource.slice(start),frozen=(await fs.readFile('tools/optimization-edge-before.jsx','utf8')).replace(/\r\n/g,'\n').split('\n').slice(2).join('\n')
assert.equal(frozen,extracted,'frozen before implementation must equal the baseline from the geometry helper through EOF')
const baselineProof={path:baselinePath,sha256:hash(baselineBytes),normalizedExcerptSha256:hash(extracted),startLine:baselineSource.slice(0,start).split('\n').length,endLine:baselineSource.split('\n').length,adjustments:'Only two harness prefix lines (comment and RF import); extracted implementation unchanged after CRLF normalization.'}
const startedAt=new Date().toISOString(),startHashes=await sourceHashes()
await build({configFile:path.resolve('vite.config.js'),logLevel:'error',build:{outDir,emptyOutDir:false,rolldownOptions:{input:path.resolve('tools/optimization-graph.html')}}})
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright')
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),target=path.resolve(outDir,'.'+pathname),relative=path.relative(outDir,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('outside root');const contents=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(contents)}catch{res.writeHead(404);res.end('not found')}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH,args:['--enable-precise-memory-info']})
const results=[],failures=[]
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]||0}
async function sample(mode,count,round,warmup=false){
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
 try{
  await page.goto(`${origin}/tools/optimization-graph.html?mode=${mode}&n=${count}`)
  await page.waitForFunction(()=>window.graphBench?.ready,{timeout:60000})
  const init=await page.evaluate(()=>({initMs:window.graphBench.initMs,nodes:window.graphBench.renderedNodes,edges:window.graphBench.renderedEdges,heap:performance.memory?.usedJSHeapSize||null}))
  assert.equal(init.nodes,count);assert.equal(init.edges,count*3)
  async function stage(name,gesture){
   const before=await page.evaluate(name=>{const b=window.graphBench;b.stage=name;return{time:performance.now(),viewport:b.rf.getViewport()}},name)
   await gesture()
   const after=await page.evaluate(async name=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const b=window.graphBench,end=performance.now(),frames=b.frames.filter(frame=>frame.stage===name),events=b.events.filter(event=>event.stage===name),up=events.filter(event=>event.type==='pointerup').at(-1);b.stage=null;return{time:end,viewport:b.rf.getViewport(),frames,events,longTasks:b.longTasks.filter(task=>task.start>=end-10000),afterMouseUpMs:up?end-up.time:null}},name)
   const frameMs=after.frames.map(frame=>frame.dt),durationMs=after.time-before.time
   return{durationMs,fps:frameMs.length?1000/(frameMs.reduce((sum,n)=>sum+n,0)/frameMs.length):null,p95FrameMs:percentile(frameMs,.95),maxFrameMs:Math.max(0,...frameMs),over33ms:frameMs.filter(n=>n>33.4).length,afterMouseUpMs:after.afterMouseUpMs,beforeViewport:before.viewport,afterViewport:after.viewport,frames:after.frames,events:after.events,longTasks:after.longTasks.filter(task=>task.start>=before.time)}
  }
  const candidate=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('.react-flow__node')].map(element=>({element,rect:element.getBoundingClientRect()})).sort((a,b)=>Math.hypot(a.rect.x+a.rect.width/2-800,a.rect.y+a.rect.height/2-500)-Math.hypot(b.rect.x+b.rect.width/2-800,b.rect.y+b.rect.height/2-500))
   for(const{element,rect}of all)for(const[x,y]of[[.5,.25],[.25,.3],[.7,.6],[.5,.75]]){const point={x:rect.x+rect.width*x,y:rect.y+rect.height*y};if(document.elementFromPoint(point.x,point.y)?.closest('.react-flow__node')===element)return{id:element.dataset.id,...point}}
   throw new Error('No visible node can receive a real pointer gesture')
  })
  const nodeBefore=await page.evaluate(id=>window.graphBench.rf.getNode(id).position,candidate.id)
  const edgeIndex=Number(candidate.id.slice(2)),edgeBefore=await page.locator('.gm8-edge-g').nth(edgeIndex).locator('path:not([stroke="transparent"])').first().getAttribute('d')
  const drag=await stage('drag',async()=>{await page.mouse.move(candidate.x,candidate.y);await page.mouse.down();for(let i=1;i<=24;i++){await page.mouse.move(candidate.x+i*3,candidate.y+i*1.5);await page.waitForTimeout(16)}await page.mouse.up()})
  const nodeAfter=await page.evaluate(id=>window.graphBench.rf.getNode(id).position,candidate.id),edgeAfter=await page.locator('.gm8-edge-g').nth(edgeIndex).locator('path:not([stroke="transparent"])').first().getAttribute('d')
  assert.ok(Math.abs(nodeBefore.x-nodeAfter.x)+Math.abs(nodeBefore.y-nodeAfter.y)>10,'drag must actually move a node');assert.notEqual(edgeBefore,edgeAfter,'incident edge geometry must follow drag')
  const pan=await stage('pan',async()=>{await page.mouse.move(45,60);await page.mouse.down();for(let i=1;i<=24;i++){await page.mouse.move(45+i*3,60+i*1.5);await page.waitForTimeout(16)}await page.mouse.up()})
  assert.ok(Math.abs(pan.afterViewport.x-pan.beforeViewport.x)>20,'pan must change viewport')
  const zoom=await stage('zoom',async()=>{await page.mouse.move(45,60);await page.keyboard.down('Control');await page.mouse.wheel(0,-200);await page.keyboard.up('Control');await page.waitForTimeout(450)})
  assert.notEqual(zoom.afterViewport.zoom,zoom.beforeViewport.zoom,'wheel must change zoom')
  assert.deepEqual(errors,[])
  const result={mode,count,round,warmup,init,drag,pan,zoom,errors}
  if(!warmup)results.push(result)
  console.log(JSON.stringify({mode,count,round,warmup,initMs:init.initMs,dragFps:drag.fps,panFps:pan.fps,zoomFps:zoom.fps,dragP95Ms:drag.p95FrameMs}))
 }finally{await context.close()}
}
try{
 if(smoke)await sample('after',100,0)
 else{
  for(const count of[100,500,1000]){
   for(const mode of['before','after'])await sample(mode,count,0,true)
   for(let round=1;round<=3;round++)for(const mode of round%2?['before','after']:['after','before'])await sample(mode,count,round)
  }
 }
}catch(error){failures.push({name:error.name,message:error.message});throw error}
finally{
 const endHashes=await sourceHashes(),sourcesUnchanged=JSON.stringify(startHashes)===JSON.stringify(endHashes)
 if(!sourcesUnchanged)failures.push({name:'SourceChanged',message:'Benchmark input changed between build start and measurement end; results are invalid.'})
 await fs.writeFile(path.resolve(`../.ui-qa/optimization/graph-${smoke?'smoke':'performance'}.json`),JSON.stringify({environment:{browser:browser.version(),node:process.version,platform:process.platform,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,viewport:{width:1600,height:1000}},sourceHashes:startHashes,endSourceHashes:endHashes,sourcesUnchanged,baselineProof,startedAt,finishedAt:new Date().toISOString(),method:'Production-compiled static harness using the same current production dependencies for both implementations; isolates geometry algorithm, not whole-app dependency upgrades. All nodes mounted, all edges drawn, real mouse drag/pan/Control-wheel, 200x140 minimap. End feedback uses two rAF after actual pointerup. Warm-up excluded, alternating three measured runs.',results,failures},null,2))
 await browser.close();await new Promise(resolve=>server.close(resolve))
 assert.ok(sourcesUnchanged,'benchmark inputs must remain frozen during the whole run')
}
