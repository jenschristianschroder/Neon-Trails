'use strict';
const assert=require('node:assert/strict');
const N=require('../wifi-core.js');
const players=n=>Array.from({length:n},(_,id)=>({id,name:'Rider '+(id+1)}));
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
function seeded(){let n=17;return()=>((n=(n*1664525+1013904223)>>>0)/4294967296);}
function roomHarness(n=2){let now=0;const messages=[],closed=[];const room=new N.HostRoom('Host',{now:()=>now,send:(key,m)=>messages.push({key,m}),close:key=>closed.push(key),random:seeded()});for(let i=1;i<n;i++){room.join('peer'+i,'P'+i,1);room.receive('peer'+i,{t:'ready',ready:true});}return{room,messages,closed,setNow(v){now=v;}};}
check('2–10 riders spawn apart, within bounds, with unique colors',()=>{
  for(let n=2;n<=10;n++){const g=new N.Arena(players(n),seeded());assert.equal(g.riders.length,n);assert.equal(new Set(g.riders.map(r=>N.COLORS[r.id])).size,n);assert.equal(g.pickups.length,12);for(const r of g.riders){assert(!g.wall(r.x,r.y,40));for(const other of g.riders)if(r!==other)assert(Math.hypot(r.x-other.x,r.y-other.y)>200);}}
  assert.throws(()=>new N.Arena(players(1)));assert.throws(()=>new N.Arena(players(11)));
});
check('room limit includes the host; all ten players must be ready',()=>{
  const h=roomHarness(10),r=h.room;assert.equal(r.players.size,10);assert(r.canStart());r.receive('peer9',{t:'ready',ready:false});assert(!r.start());r.receive('peer9',{t:'ready',ready:true});assert(r.canStart());
  assert.equal(r.join('extra','Eleventh',1),null);assert.match(h.messages.at(-1).m.reason,/full/);assert.equal(h.closed.at(-1),'extra');assert.equal(r.players.size,10);assert(r.start());assert.equal(r.game.riders.length,10);
});
check('lobby departures free slots and mismatched versions are rejected',()=>{
  const h=roomHarness(10),r=h.room;r.disconnect('peer4');assert.equal(r.players.size,9);assert.equal(r.join('replacement','New rider',1),4);assert(!r.canStart());assert.equal(r.join('old','Old browser',99),null);assert.match(h.messages.at(-1).m.reason,/version/);
});
check('late joins cannot enter a running match',()=>{
  const h=roomHarness();h.room.start();assert.equal(h.room.join('late','Late',1),null);assert.match(h.messages.at(-1).m.reason,/match has started/);assert.equal(h.room.players.size,2);
});
check('only the owning peer can submit bounded, ordered steering input',()=>{
  const {room:r}=roomHarness(3);r.start();r.receive('unknown',{t:'input',seq:9,x:1,y:0});assert.equal(r.inputs.size,0);
  r.receive('peer1',{t:'input',id:0,seq:1,x:1,y:1});assert(!r.inputs.has(0));assert.equal(r.inputs.size,1);assert(Math.abs(Math.hypot(r.inputs.get(1).x,r.inputs.get(1).y)-1)<1e-8);
  r.receive('peer1',{t:'input',seq:1,x:-1,y:0});assert(r.inputs.get(1).x>0);
  for(const m of [{seq:2,x:Infinity,y:0},{seq:2,x:2,y:0},{seq:2,x:'1',y:0},{seq:2.5,x:0,y:0}])r.receive('peer1',{t:'input',...m});assert.equal(r.sequences.get(1),1);
  r.receive('peer1',{t:'state',state:{winner:1}});r.receive('peer1',{t:'start'});assert.equal(r.game.phase,'countdown');
});
check('missing input cruises; a missing heartbeat disconnects only that rider',()=>{
  const h=roomHarness(3),r=h.room;r.start();r.game.phase='live';r.receive('peer1',{t:'input',seq:0,x:1,y:0});h.setNow(700);r.tick(1/60);assert(!r.inputs.has(1));assert(r.game.riders[1].speed>0);
  r.receive('peer2',{t:'ping',sent:700});h.setNow(10001);r.tick(1/60);assert(!r.peers.has('peer1'));assert(r.peers.has('peer2'));assert(!r.game.riders[1].alive);assert.equal(r.game.phase,'live');
});
check('neutral riders never stop, and the field closes after 45 seconds',()=>{
  const g=new N.Arena(players(10),seeded());g.phase='live';g.tick(1/60,new Map());assert(g.riders.every(r=>r.speed===117&&r.distance>0));g.time=44;g.tick(1/60,new Map());assert.equal(g.inset,0);g.time=46;g.tick(1/60,new Map());assert(g.inset>0);
});
check('head-on crashes resolve simultaneously as a draw',()=>{
  const g=new N.Arena(players(2),seeded());g.phase='live';Object.assign(g.riders[0],{x:1000,y:800,trailX:1000,trailY:800,angle:0});Object.assign(g.riders[1],{x:1016,y:800,trailX:1016,trailY:800,angle:Math.PI});g.tick(1/60,new Map());assert(g.riders.every(r=>!r.alive));assert.equal(g.winner,null);assert(g.players.every(p=>p.score===0));assert.equal(g.phase,'roundover');
});
check('finite trails trim collision data and length pickups remain bounded',()=>{
  const g=new N.Arena(players(2),seeded()),r=g.riders[0],other=g.riders[1];Object.assign(r,{trailX:100,y:600,trailY:600,distance:100});g.addTrail(r,200,600);r.distance=200;g.addTrail(r,300,600);r.trailLength=120;g.trimTrail(r);assert(!g.trailHit(other,150,580,150,620));assert(g.trailHit(other,220,580,220,620));
  for(let i=0;i<10;i++)g.applyPickup(r,'long');assert.equal(r.trailLength,1100);for(let i=0;i<10;i++)g.applyPickup(r,'short');assert.equal(r.trailLength,180);r.distance=1000;g.trimTrail(r);assert.equal(g.hash.size,0);
});
check('speed pickups replace one another and expire without stopping',()=>{
  const g=new N.Arena(players(2),seeded()),r=g.riders[0];g.phase='live';g.applyPickup(r,'fast');assert.equal(r.speedFactor,1.35);g.applyPickup(r,'slow');assert.equal(r.speedFactor,.7);g.time=11;g.tick(1/60,new Map());assert.equal(r.speedFactor,1);assert(r.speed>0);
});
check('last survivor scores once; first to three ends the match',()=>{
  const g=new N.Arena(players(10),seeded());for(let i=1;i<=3;i++){g.phase='live';g.riders.slice(1).forEach(r=>r.alive=false);g.tick(1/60,new Map());assert.equal(g.players[0].score,i);g.tick(1/60,new Map());assert.equal(g.players[0].score,i);if(i<3){assert.equal(g.phase,'roundover');g.nextRound();assert(g.riders.every(r=>r.alive));}}
  assert.equal(g.phase,'matchover');assert.deepEqual(g.champions,[0]);
});
check('disconnections during and between rounds cannot strand the host',()=>{
  const h=roomHarness(),r=h.room;r.start();r.game.phase='roundover';r.disconnect('peer1');assert.equal(r.game.phase,'matchover');assert.deepEqual(r.game.champions,[0]);assert(r.returnToLobby());assert.equal(r.players.size,1);assert(!r.canStart());
  r.join('new','New',1);r.receive('new',{t:'ready',ready:true});assert(r.start());r.disconnect('new');assert.equal(r.game.phase,'matchover');assert.deepEqual(r.game.champions,[0]);
});
check('host pause freezes the room and clears steering',()=>{
  const {room:r}=roomHarness();r.start();r.game.phase='live';r.hostInput(1,0);r.pause(true);const before=r.game.riders[0].x;r.tick(1/60);assert.equal(r.game.riders[0].x,before);assert.equal(r.inputs.size,0);r.pause(false);r.tick(1/60);assert.notEqual(r.game.riders[0].x,before);
});
check('bounded snapshots cover ten full trails and reject malformed state',()=>{
  const {room:r}=roomHarness(10);r.start();for(const rider of r.game.riders){rider.trailLength=1100;for(let i=1;i<=250;i++){rider.distance=i*6;r.game.addTrail(rider,rider.trailX+6,rider.trailY);r.game.trimTrail(rider);}}
  const packet=r.packet();assert(N.validState(packet));assert(JSON.stringify(packet).length<50000);assert(packet.state.riders.every(p=>p.trail.length<=200));
  for(const change of [p=>p.v=999,p=>p.state.riders[0].x=NaN,p=>p.state.riders[0].trail.push([1,2,3]),p=>p.state.players[1].id=0,p=>p.state.pickups[0].type='bad',p=>p.state.champions=[99]]){const p=structuredClone(packet);change(p);assert(!N.validState(p));}
});
console.log(count+' Wi-Fi arena checks passed.');
