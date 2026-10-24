import React, { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, MiniMap, Background, useNodesInitialized, useReactFlow } from '@xyflow/react'
import { EdgeLayer as BeforeEdgeLayer } from './optimization-edge-before'
import { EdgeLayer, nodeTypes } from '../src/gamemap/board/shared'
import '../src/gamemap/board/canvas.css'
import '../src/index.css'
const params=new URLSearchParams(location.search), count=Number(params.get('n')||100), mode=params.get('mode')||'after'
document.documentElement.classList.add('dark')
const EMPTY=[]
window.graphBench={ready:false,stage:null,frames:[],longTasks:[],events:[],mode,count}
const bench=window.graphBench
let previous=performance.now()
function loop(now){if(bench.stage)bench.frames.push({stage:bench.stage,time:now,dt:now-previous});previous=now;requestAnimationFrame(loop)}
requestAnimationFrame(loop)
new PerformanceObserver(list=>bench.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({entryTypes:['longtask']})
for(const type of['pointerdown','pointermove','pointerup','wheel'])document.addEventListener(type,event=>{if(bench.stage)bench.events.push({stage:bench.stage,type,time:performance.now(),x:event.clientX,y:event.clientY})},{capture:true,passive:true})
function Scene(){
 const initialized=useNodesInitialized(),rf=useReactFlow()
 const data=useMemo(()=>{
  const columns=Math.ceil(Math.sqrt(count)),nodes=Array.from({length:count},(_,i)=>({id:'c-'+i,type:'character',position:{x:(i%columns)*300,y:Math.floor(i/columns)*170},data:{label:'角色 '+i,alias:'档案',role:'主线',gradient:'linear-gradient(135deg,#6366f1,#a855f7)',miniColor:'#6366f1',density:'standard',relCount:6}}))
  let seed=42;const edges=[],seen=new Set()
  for(let i=0;edges.length<count*3;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const source=edges.length%count,target=edges.length<count?(source+1)%count:(source+1+seed%(count-1))%count,type=i%3,key=`${source}:${target}:${type}`;if(seen.has(key))continue;seen.add(key);edges.push({id:'e-'+edges.length,source:'c-'+source,target:'c-'+target,data:{relation:{id:edges.length,relation_type_id:type}}})}
  return{nodes,edges,types:new Map([[0,{name:'朋友',color:'#84cc16',directional:true}],[1,{name:'同伴',color:'#06b6d4'}],[2,{name:'对手',color:'#f97316',line_style:'dashed'}]])}
 },[])
 useEffect(()=>{
  bench.rf=rf
  if(!initialized)return
  let cancelled=false
  rf.fitView({padding:0.08,minZoom:0.02,maxZoom:1})
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!cancelled){bench.ready=true;bench.initMs=performance.now()-window.__graphStart;bench.renderedNodes=document.querySelectorAll('.react-flow__node').length;bench.renderedEdges=document.querySelectorAll('.gm8-edge-g').length}}))
  return()=>{cancelled=true}
 },[initialized,rf])
 const Layer=mode==='before'?BeforeEdgeLayer:EdgeLayer
 return <div className="gm8-board gm-workspace" style={{height:'100vh',position:'relative',background:'var(--gm-canvas-bg)'}}>
  <ReactFlow defaultNodes={data.nodes} edges={EMPTY} nodeTypes={nodeTypes} onlyRenderVisibleElements={false} minZoom={0.02} maxZoom={4} proOptions={{hideAttribution:true}}>
   <Background gap={22} color="var(--gm-grid)"/><MiniMap pannable zoomable style={{width:200,height:140}} />
  </ReactFlow><Layer edges={data.edges} typeMap={data.types} onEdgeClick={()=>{}} />
 </div>
}
createRoot(document.getElementById('root')).render(<ReactFlowProvider><Scene/></ReactFlowProvider>)
