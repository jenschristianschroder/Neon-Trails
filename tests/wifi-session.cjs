'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const core=fs.readFileSync('wifi-core.js','utf8'),app=fs.readFileSync('wifi.js','utf8'),html=fs.readFileSync('wifi.html','utf8');
let now=0,nextTimer=1,nextPeer=1,queue=[],timers=new Map(),peers=new Map(),traffic=[];
function flush(){let n=0;while(queue.length){if(++n>10000)throw Error('Message loop');queue.shift()();}}
function schedule(fn,delay,interval=false){const id=nextTimer++;timers.set(id,{fn,at:now+delay,delay,interval});return id;}
function advance(ms){const until=now+ms;while(now<until){const next=Math.min(until,...[...timers.values()].map(t=>t.at));now=next;for(const [id,t] of [...timers])if(t.at<=now){if(t.interval)t.at+=t.delay;else timers.delete(id);t.fn();}flush();}}
class Events{constructor(){this.listeners={};}on(type,fn){(this.listeners[type]??=[]).push(fn);}emit(type,value){for(const fn of this.listeners[type]||[])fn(value);}}
class Connection extends Events{
  constructor(metadata){super();this.metadata=metadata;this.open=false;this.bufferSize=0;this.dataChannel={bufferedAmount:0};}
  send(m){assert(this.open);const copy=JSON.parse(JSON.stringify(m));traffic.push({from:this,message:copy});queue.push(()=>{if(this.other.open)this.other.emit('data',copy);});}
  close(){if(this.closed)return;this.closed=true;this.open=false;queue.push(()=>this.emit('close'));if(this.other&&!this.other.closed){this.other.closed=true;this.other.open=false;queue.push(()=>this.other.emit('close'));}}
}
class Peer extends Events{
  constructor(id){super();this.id=typeof id==='string'?id:'guest-'+nextPeer++;this.connections=[];if(peers.has(this.id)){queue.push(()=>this.emit('error',{type:'unavailable-id'}));return;}peers.set(this.id,this);queue.push(()=>this.emit('open',this.id));}
  connect(id,options){const c=new Connection(options.metadata),other=new Connection(options.metadata);c.other=other;other.other=c;this.connections.push(c);queue.push(()=>{const target=peers.get(id);if(!target){this.emit('error',{type:'peer-unavailable'});return;}target.connections.push(other);target.emit('connection',other);queue.push(()=>{c.open=other.open=true;c.emit('open');other.emit('open');});});return c;}
  destroy(){if(peers.get(this.id)===this)peers.delete(this.id);for(const c of this.connections)c.close();}
}
function browser(name){
  const elements=new Map(),windowEvents=new Map(),documentEvents=new Map();
  const context=new Proxy({},{get:(o,key)=>o[key]??(()=>{})});
  function element(id='',tag='div'){
    const classes=new Set();return{id,tagName:tag.toUpperCase(),textContent:'',value:'',hidden:false,disabled:false,children:[],listeners:{},parent:null,style:{setProperty(key,value){this[key]=value;}},classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},toggle(c,value){if(value??!classes.has(c))classes.add(c);else classes.delete(c);},contains(c){return classes.has(c);}},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},append(...children){this.children.push(...children);children.forEach(c=>c.parent=this);},replaceChildren(){this.children=[];},getContext(){return context;},contains(node){while(node){if(node===this)return true;node=node.parent;}return false;},
      getBoundingClientRect(){return id==='safe-frame'?{left:0,top:44,width:390,height:766}:{left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:parseFloat(this.style.width)||120,height:parseFloat(this.style.height)||120};},hasPointerCapture(){return false;},setPointerCapture(){},releasePointerCapture(){}};
  }
  for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const e=element(match[2],match[1]);e.hidden=/\bhidden\b/.test(match[0]);e.disabled=/\bdisabled\b/.test(match[0]);elements.set(e.id,e);}
  elements.get('knob').parent=elements.get('pad');
  const document={hidden:false,body:{style:{}},documentElement:element(),getElementById:id=>{assert(elements.has(id),'known element '+id);return elements.get(id);},createElement:tag=>element('',tag),addEventListener(type,fn){(documentEvents.get(type)||documentEvents.set(type,[]).get(type)).push(fn);}};
  const sandbox={document,console,performance:{now:()=>now},crypto:webcrypto,Peer,innerWidth:390,innerHeight:844,devicePixelRatio:1,URL,URLSearchParams,location:{href:'https://example.test/wifi.html',search:''},navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,requestAnimationFrame(){},setInterval:(fn,ms)=>schedule(fn,ms,true),setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),addEventListener(type,fn){(windowEvents.get(type)||windowEvents.set(type,[]).get(type)).push(fn);},ontouchstart:null};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(core,sandbox);vm.runInContext(app,sandbox);elements.get('name').value=name;
  const b={$:id=>elements.get(id),sandbox,document,click(id){const e=elements.get(id);assert(!e.disabled,'button enabled: '+id);assert(!e.hidden,'button visible: '+id);for(const fn of e.listeners.click||[])fn({target:e});flush();},event(type,props={},target='document'){const e={cancelable:true,preventDefault(){this.prevented=true;},...props};for(const fn of (target==='document'?documentEvents:windowEvents).get(type)||[])fn(e);flush();return e;}};
  return b;
}
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const host=browser('Host');host.click('create');const code=host.$('room-code').textContent;
const guests=[];
check('a real application host creates a six-character room',()=>{assert.match(code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(host.$('player-count').textContent,'1 / 10 players');assert(host.$('start').disabled);});
check('nine independent browser contexts join the host through the transport adapter',()=>{
  for(let i=1;i<=9;i++){const guest=browser('Rider '+i);guest.$('code').value=code;guest.click('join');guests.push(guest);assert(!guest.$('lobby').hidden);}
  assert.equal(host.$('player-count').textContent,'10 / 10 players');assert(guests.every(g=>g.$('player-count').textContent==='10 / 10 players'));
});
check('the eleventh browser sees a room-full message without affecting existing players',()=>{const extra=browser('Extra');extra.$('code').value=code;extra.click('join');assert.match(extra.$('status').textContent,/Room full/);assert.equal(host.$('player-count').textContent,'10 / 10 players');advance(300);assert.match(extra.$('status').textContent,/Room full/);});
check('ready acknowledgements enable a host-only start for all ten screens',()=>{for(const guest of guests)guest.click('ready');assert(!host.$('start').disabled);host.click('start');assert(!host.$('game').hidden);assert(guests.every(g=>!g.$('game').hidden));assert(guests.every(g=>g.$('alive').textContent==='10 / 10 ALIVE'));assert(guests.every(g=>g.$('start').hidden));});
check('steering is transmitted; touching game buttons is not swallowed',()=>{
  const g=guests[0],pad=g.$('pad'),b=pad.getBoundingClientRect(),finger={identifier:1,target:pad,clientX:b.left+b.width/2+25,clientY:b.top+b.height/2};
  const start=g.event('touchstart',{touches:[finger],changedTouches:[finger]});assert(start.prevented);assert.match(g.$('knob').style.transform,/translate\(25px/);assert(traffic.some(t=>t.message.t==='input'&&t.message.x>0));
  g.event('touchend',{touches:[],changedTouches:[finger]});assert.equal(g.$('knob').style.transform,'');
  const buttonTouch={identifier:2,target:g.$('exit-game'),clientX:1,clientY:1};assert(!g.event('touchstart',{touches:[buttonTouch],changedTouches:[buttonTouch]}).prevented);
});
check('host visibility pauses everyone, and host resume restarts the shared clock',()=>{
  host.document.hidden=true;host.event('visibilitychange');assert(!host.$('paused').hidden);assert(guests.every(g=>!g.$('paused').hidden));advance(1000);host.document.hidden=false;host.event('visibilitychange');host.click('resume');assert(host.$('paused').hidden);assert(guests.every(g=>g.$('paused').hidden));
});
check('all clients receive synchronized live state; slow peers do not queue snapshots',()=>{
  advance(4000);const states=traffic.filter(t=>t.message.t==='state');assert(states.some(t=>t.message.state.phase==='live'));assert(guests.every(g=>!g.$('game').hidden));
  const server=[...peers.values()].find(p=>p.id.startsWith('neon-trails-wifi')),slow=server.connections[0];slow.dataChannel.bufferedAmount=100000;const before=traffic.filter(t=>t.from===slow&&t.message.t==='state').length;advance(250);assert.equal(traffic.filter(t=>t.from===slow&&t.message.t==='state').length,before);slow.dataChannel.bufferedAmount=0;advance(100);assert(traffic.filter(t=>t.from===slow&&t.message.t==='state').length>before);
});
check('new players cannot enter mid-match',()=>{const late=browser('Late');late.$('code').value=code;late.click('join');assert.match(late.$('status').textContent,/match has started/);});
check('one guest leaving keeps the other nine screens connected',()=>{guests[8].click('exit-game');advance(100);assert(guests[8].$('game').hidden);assert(!host.$('game').hidden);assert(guests.slice(0,8).every(g=>!g.$('game').hidden));const packet=traffic.filter(t=>t.message.t==='state').at(-1).message;assert.equal(packet.state.players.filter(p=>p.connected).length,9);assert(!packet.state.riders.find(r=>r.id===9).alive);});
check('a complete round reaches the shared results screen and can restart',()=>{
  for(let i=0;i<40&&host.$('result').hidden;i++)advance(1000);assert(!host.$('result').hidden);assert(guests.slice(0,8).every(g=>!g.$('result').hidden));assert.equal(host.$('scores').children.length,10);host.click('next');assert(host.$('result').hidden);assert(guests.slice(0,8).every(g=>g.$('round').textContent==='ROUND 2'));assert.equal(host.$('alive').textContent,'9 / 9 ALIVE');
});
check('closing the host ends every guest session with a recovery path',()=>{host.click('exit-game');assert(host.$('game').hidden);for(const g of guests.slice(0,8)){assert(g.$('game').hidden);assert.match(g.$('status').textContent,/host closed/);assert(!g.$('retry').hidden);}advance(1000);assert(host.$('game').hidden);});
check('a host can create another room after cleanup without stale callbacks',()=>{host.click('create');assert.equal(host.$('player-count').textContent,'1 / 10 players');assert(!host.$('lobby').hidden);});
console.log(count+' multiplayer session checks passed (one host + nine guest contexts).');
