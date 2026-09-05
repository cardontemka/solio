import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const e=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]))
const svc=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const RUN=Date.now().toString(36)
const em=`mn.${RUN}@example.invalid`
const {data:cu}=await svc.auth.admin.createUser({email:em,password:'mn12345',email_confirm:true,
  user_metadata:{username:'mn'+RUN,display_name:'Menu Тест'}})
const PORT=9910
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const proc=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check',
  '--user-data-dir=/private/tmp/claude-501/-Users-cardon-Desktop-gerhub-solio/af254235-e20f-43d9-a143-7cf0611f66df/scratchpad/cpNN','--window-size=1300,1000','about:blank'],{stdio:'ignore'})
let list=null
for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,1000));try{list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();if(list?.length)break}catch{}}
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>ws.onopen=r)
let id=0;const w=new Map()
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&w.has(d.id)){w.get(d.id)(d);w.delete(d.id)}}
const send=(m2,pp={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m2,params:pp}));return new Promise(r=>w.set(i,r))}
const ev=async x=>(await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true})).result?.result?.value
await send('Page.enable');await send('Runtime.enable')
await send('Page.navigate',{url:'http://localhost:3000/login'});await new Promise(r=>setTimeout(r,4500))
await ev(`(()=>{const f=[...document.querySelectorAll('form')].find(x=>x.querySelector('input[name=password]'));
 const s=(n,v)=>{const el=f.querySelector('input[name='+n+']');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);
   el.dispatchEvent(new Event('input',{bubbles:true}))};
 s('email','${em}');s('password','mn12345');f.requestSubmit();return 1})()`)
await new Promise(r=>setTimeout(r,7000))
await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:2,mobile:true})
await send('Emulation.setEmitTouchEventsForMouse',{enabled:true,configuration:'mobile'})
await send('Page.navigate',{url:'http://localhost:3000/'});await new Promise(r=>setTimeout(r,5000))

// (a) JS дуудлагаар
await ev(`document.querySelector('header button[aria-haspopup=menu]').click()`)
await new Promise(r=>setTimeout(r,900))
console.log('  (a) JS click →', await ev(`document.querySelector('[role=menu]')? '✓ нээгдэв':'🔴 үгүй'`),
  '| aria-expanded =', await ev(`document.querySelector('header button[aria-haspopup=menu]').getAttribute('aria-expanded')`))
await ev(`document.body.click()`); await new Promise(r=>setTimeout(r,600))

// (b) Бодит хүрэлтээр (touch)
const box = await ev(`(()=>{const r=document.querySelector('header button[aria-haspopup=menu]').getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`)
const {x,y}=JSON.parse(box)
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
await new Promise(r=>setTimeout(r,900))
console.log('  (b) хүрэлт   →', await ev(`document.querySelector('[role=menu]')? '✓ нээгдэв':'🔴 үгүй'`),
  '| цэсний зүйлс:', await ev(`[...document.querySelectorAll('[role=menu] a,[role=menu] button')].map(x=>x.innerText.trim()).join(', ')||'—'`))
console.log('  товчны хэмжээ:', await ev(`(()=>{const r=document.querySelector('header button[aria-haspopup=menu]').getBoundingClientRect();
  return Math.round(r.width)+'x'+Math.round(r.height)})()`))
ws.close();proc.kill()
await svc.auth.admin.deleteUser(cu.user.id)
