import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright')
const vendorPath=path.resolve('../.ui-qa/optimization/elk-poc/package/lib/elk.bundled.js'), vendor=await fs.readFile(vendorPath,'utf8')
const apiSource=await fs.readFile(path.resolve('../.ui-qa/optimization/elk-poc/package/lib/elk-api.js'),'utf8'),workerSource=await fs.readFile(path.resolve('../.ui-qa/optimization/elk-poc/package/lib/elk-worker.min.js'),'utf8')
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage()
await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'&&url.port==='60111'?route.continue():route.abort()})
function graph(count){
  let seed=42
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/count>>>0}
  const edges=[];for(let i=0;i<count*3;i++){const source=i<count-1?i:(next()%count),target=i<count-1?i+1:next()%count;if(source!==target)edges.push({id:'e'+i,sources:['n'+source],targets:['n'+target]})}
  return{id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.spacing.nodeNode':'80','elk.layered.spacing.nodeNodeBetweenLayers':'100','elk.randomSeed':'42'},children:Array.from({length:count},(_,i)=>({id:'n'+i,width:208,height:80})),edges}
}
function quality(nodes,edges){
 const byId=new Map(nodes.map(node=>[node.id,node]));let overlaps=0,crossings=0
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)overlaps++}
 const lines=edges.map(edge=>{const a=byId.get(edge.sources[0]),b=byId.get(edge.targets[0]);return{edge,a:{x:a.x+a.width/2,y:a.y+a.height/2},b:{x:b.x+b.width/2,y:b.y+b.height/2}}})
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){const a=lines[i],b=lines[j];if(a.edge.sources[0]===b.edge.sources[0]||a.edge.sources[0]===b.edge.targets[0]||a.edge.targets[0]===b.edge.sources[0]||a.edge.targets[0]===b.edge.targets[0])continue;if(cross(a.a,a.b,b.a)*cross(a.a,a.b,b.b)<0&&cross(b.a,b.b,a.a)*cross(b.a,b.b,a.b)<0)crossings++}
 return{nodes:nodes.length,edges:edges.length,overlaps,straightLineCrossings:crossings,width:Math.max(...nodes.map(n=>n.x+n.width))-Math.min(...nodes.map(n=>n.x)),height:Math.max(...nodes.map(n=>n.y+n.height))-Math.min(...nodes.map(n=>n.y))}
}
const results=[]
try{
 await page.goto('http://127.0.0.1:60111/tools/optimization-frontend.html');await page.locator('.cm-editor').waitFor()
 for(const count of[100,500]){
  const input=graph(count),cols=Math.ceil(Math.sqrt(count))
  const before=quality(input.children.map((node,i)=>({...node,x:i%cols*340,y:Math.floor(i/cols)*200})),input.edges)
  const sample=await page.evaluate(async({apiSource,workerSource,input})=>{
   const frames=[],longTasks=[];let raf,last=performance.now(),running=true
   const loop=now=>{frames.push(now-last);last=now;if(running)raf=requestAnimationFrame(loop)};raf=requestAnimationFrame(loop)
   const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({entryTypes:['longtask']})
   ;(0,eval)(apiSource)
   const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(url),start=performance.now()
   const engine=new window.ELK({workerFactory:()=>worker})
   try{
    const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('ELK 30s deadline')),30000);engine.layout(input,{measureExecutionTime:true}).then(result=>{clearTimeout(timer);resolve({result,coreMs:performance.now()-start})},error=>{clearTimeout(timer);reject(error)})})
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    if(result.error)throw new Error(result.error)
    return{...result,elapsedMs:performance.now()-start,frames,longTasks,frameMaxMs:Math.max(...frames)}
   }finally{running=false;cancelAnimationFrame(raf);observer.disconnect();worker.terminate();URL.revokeObjectURL(url)}
  },{apiSource,workerSource,input})
  const after=quality(sample.result.children,input.edges);assert.equal(after.nodes,count);assert.equal(after.overlaps,0);assert.ok(sample.result.children.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)))
  const result={count,before,after,workerCoreMs:sample.coreMs,elapsedMs:sample.elapsedMs,frameMaxMs:sample.frameMaxMs,longTasks:sample.longTasks,frames:sample.frames}
  results.push(result);console.log(JSON.stringify({...result,frames:undefined}))
 }
}finally{
 await fs.writeFile(path.resolve('../.ui-qa/optimization/elk-poc/results.json'),JSON.stringify({version:'elkjs@0.12.0',license:'EPL-2.0 OR GPL-3.0-or-later',vendorSha256:createHash('sha256').update(vendor).digest('hex'),browser:browser.version(),note:'Crossings use straight center-lines, matching existing custom EdgeLayer; ELK routed bend points are intentionally not counted as a routing improvement.',results},null,2));await browser.close()
}
