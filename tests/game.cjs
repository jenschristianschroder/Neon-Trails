'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(fs.existsSync('index.html')?'index.html':'dist/index.html','utf8');
const original=html.split('<script>')[1].split('</script>')[0];
new vm.Script(original);

function harness(touchSupport=true,seed=17){
  const elements=new Map(),documentEvents=new Map(),windowEvents=new Map();
  const context=new Proxy({}, {get:(o,k)=>k in o?o[k]:(...args)=>{}});
  function element(parent=null){
    const children=new Map(),classes=new Set(),captures=new Set();
    return {parent,hidden:true,checked:true,dataset:{},listeners:{},style:{setProperty(){}},classList:{add(c){classes.add(c)},remove(c){classes.delete(c)},toggle(c){classes.has(c)?classes.delete(c):classes.add(c)},contains(c){return classes.has(c)}},
      addEventListener(type,fn){this.listeners[type]=fn},getContext(){return context},getBoundingClientRect(){return {left:0,top:0,width:100,height:100}},
      setAttribute(){},append(){},replaceChildren(){},focus(){},contains(n){while(n){if(n===this)return true;n=n.parent}return false},closest(){return null},
      setPointerCapture(id){if(this.captureFails)throw Error('no capture');captures.add(id)},hasPointerCapture(id){return captures.has(id)},releasePointerCapture(id){captures.delete(id)},
      querySelector(s){if(!children.has(s))children.set(s,element(this));return children.get(s)},querySelectorAll(){return []}};
  }
  const document={hidden:false,documentElement:{},getElementById(id){if(!elements.has(id)){elements.set(id,element());if(id==='safe-frame')elements.get(id).getBoundingClientRect=()=>({left:0,top:0,width:sandbox.innerWidth,height:sandbox.innerHeight});}return elements.get(id)},querySelector(){return element()},querySelectorAll(){return []},createElement(){return element()},addEventListener(type,fn,options){documentEvents.set(type,{fn,options})}};
  const window={addEventListener(type,fn){windowEvents.set(type,fn)},getSelection(){return {removeAllRanges(){}}}};
  if(touchSupport)window.ontouchstart=null;
  const seededMath=Object.create(Math);seededMath.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const sandbox={document,window,Math:seededMath,innerWidth:390,innerHeight:844,devicePixelRatio:1,matchMedia(){return {matches:true}},localStorage:{getItem(){return null},setItem(){}},performance:{now(){return 0}},requestAnimationFrame(){},console};
  const source=original.replace('  boot();\n})();',`  boot();
    globalThis.test={start(mode='solo',map=0,level='normal'){selectedMode=mode;selectedMap=map;difficulty=level;startMatch()},step,inputs,keys,ready,pauseGame,resume,home,layout,releaseInput,clearInputs,segmentDistance,segmentRect,distanceToSegment,wallHit,trailHit,addTrail,trimTrail,applyPickup,updatePickups,pickupSafe,insetAt,makeRider,makeViews,boardFor,padTravel,cameraFor,minimapFor,safeFor,followedRider,render,world:{w:W,h:H,r:R,trail:TRAIL,speed:SPEED},
      get game(){return game},get screen(){return screen},get ui(){return ui},get views(){return views},set screen(v){screen=v},
      simulate(seconds){for(let i=0;i<Math.ceil(seconds/STEP)&&screen==='playing';i++)step(STEP)}};
  })();`);
  assert.notEqual(source,original,'test seam exists');vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const t=sandbox.test;
  function dispatch(type,target,props={}){const e={type,target:target||element(),button:0,buttons:1,pointerType:'touch',cancelable:true,preventDefault(){this.prevented=true},...props};documentEvents.get(type)?.fn(e);target?.listeners[type]?.(e);return e;}
  function touch(id,target,x=99,y=50){return {identifier:id,target,clientX:x,clientY:y};}
  return {t,dispatch,touch,documentEvents,windowEvents,document,element,elements,sandbox};
}
function check(name,fn){fn();console.log('PASS '+name)}
function live(t){t.game.phase='live';}

check('all modes and arenas start with safe spawns and appropriate teams',()=>{
  const {t}=harness();for(const mode of ['solo','duel','coop'])for(let map=0;map<3;map++){
    t.start(mode,map);assert.equal(t.game.riders.length,mode==='coop'?4:2);assert.equal(t.ui.length,mode==='solo'?1:2);
    for(const r of t.game.riders)assert.equal(t.wallHit(r,r.x,r.y,r.x,r.y),false);
  }
});
check('neutral and released controls keep cruising and leave a trail',()=>{
  const {t}=harness();t.start('duel');live(t);const p=t.game.riders[0];
  t.simulate(1);assert(p.distance>110);assert(p.speed>0);assert(t.game.segmentCount>0);
  t.inputs[0].x=1;t.simulate(.5);t.releaseInput(0);const before=p.distance,heading=p.angle;t.simulate(.5);
  assert(p.distance>before+50);assert.equal(p.angle,heading);assert(p.speed>0);
});
check('old trail sections disappear from collision data, including partial segments',()=>{
  const {t}=harness();t.start('duel');const p=t.game.riders[0],other=t.game.riders[1];p.trailX=200;p.trailY=500;p.distance=100;t.addTrail(p,300,500);p.distance=200;t.addTrail(p,400,500);
  p.trailLength=120;t.trimTrail(p);assert(!t.trailHit(other,240,470,240,530));assert(t.trailHit(other,320,470,320,530));
  p.distance=500;t.trimTrail(p);assert.equal(p.segments.length,0);assert.equal(t.game.hash.size,0);assert.equal(t.game.segmentCount,0);
});
check('length pickups are bounded and never resurrect an erased tail',()=>{
  const {t}=harness();t.start('duel');const p=t.game.riders[0];for(let i=0;i<10;i++)t.applyPickup(p,'long');assert.equal(p.trailLength,1100);
  for(let i=0;i<10;i++)t.applyPickup(p,'short');assert.equal(p.trailLength,180);t.applyPickup(p,'long');assert.equal(p.trailLength,360);assert.equal(p.segments.length,0);
});
check('pickups collect along movement, expire, respawn safely and reset each round',()=>{
  const {t}=harness();t.start('duel');live(t);const r=t.game.riders[0];Object.assign(r,{x:300,y:500,trailX:300,trailY:500,angle:0});t.game.pickups=[{type:'fast',x:330,y:500}];t.game.pickupQueue=[];
  t.simulate(.3);assert.equal(r.speedFactor,1.35);assert.equal(t.game.pickups.length,0);assert.equal(t.game.pickupQueue.length,1);
  t.applyPickup(r,'slow');assert.equal(r.speedFactor,.7);assert.equal(r.speedUntil,t.game.time+10);
  const until=r.speedUntil;t.game.time=until;t.step(1/120);assert.equal(r.speedFactor,1);assert(r.speed>0);assert.equal(t.game.pickupQueue.length,0);assert.equal(t.game.pickups.length,1);
  const pickup=t.game.pickups[0];assert(!t.wallHit(r,pickup.x,pickup.y,pickup.x,pickup.y,t.game.inset+20));
  t.applyPickup(r,'long');t.applyPickup(r,'fast');t.start('duel');assert.equal(t.game.riders[0].trailLength,520);assert.equal(t.game.riders[0].speedFactor,1);assert.equal(t.game.pickups.length,8);
});
check('every arena seeds all four pickup types clear of obstacles',()=>{
  const {t}=harness();for(let map=0;map<3;map++){t.start('coop',map);assert.equal(t.game.pickups.length,8);assert.equal(new Set(t.game.pickups.map(p=>p.type)).size,4);for(const p of t.game.pickups)assert(!t.wallHit(null,p.x,p.y,p.x,p.y,32));}
});
check('continuous collision catches crossings and obstacles',()=>{
  const {t}=harness();assert.equal(t.segmentDistance(0,0,100,100,0,100,100,0),0);assert.equal(t.segmentDistance(0,0,100,0,30,4,50,4),4);
  assert(t.segmentRect(0,50,100,50,{x:40,y:40,w:20,h:20},6));
  t.start('duel');const p=t.game.riders[1];p.trailX=200;p.trailY=50;p.distance=100;t.addTrail(p,200,400);assert(t.trailHit(t.game.riders[0],100,200,300,200));
});
check('head-on and crossing riders receive a fair simultaneous draw',()=>{
  const {t}=harness();t.start('duel');live(t);Object.assign(t.game.riders[0],{x:350,y:240,trailX:350,trailY:240,angle:0});Object.assign(t.game.riders[1],{x:370,y:240,trailX:370,trailY:240,angle:Math.PI});t.inputs[0].x=1;t.inputs[1].x=-1;t.simulate(.1);
  assert.equal(t.screen,'roundover');assert.equal(t.game.winner,null);assert(t.game.riders.every(r=>!r.alive));assert.equal(t.game.scores[0]+t.game.scores[1],0);
});
check('hands-off play cannot stall and the closing field is delayed',()=>{
  const {t}=harness();t.start('duel');assert.equal(t.insetAt(39),0);assert(t.insetAt(41)>0);t.simulate(35);assert.notEqual(t.screen,'playing');assert(t.game.riders.every(r=>r.distance>0));assert(t.game.time<40);
});
check('co-op continues with one surviving teammate and ends when a team is eliminated',()=>{
  const {t}=harness();t.start('coop');live(t);t.game.riders[0].alive=false;t.step(1/120);assert.equal(t.screen,'playing');t.game.riders[2].alive=t.game.riders[3].alive=false;t.step(1/120);assert.equal(t.game.winner,0);assert.equal(t.game.scores[0],1);
});
check('round readiness, arena rotation, first-to-three, and replay reset',()=>{
  const {t}=harness();t.start('duel');for(let round=1;round<=3;round++){
    live(t);t.game.riders[1].alive=false;t.step(1/120);assert.equal(t.game.scores[0],round);t.ready(0);assert.notEqual(t.screen,'playing');t.ready(1);
    if(round<3){assert.equal(t.game.round,round+1);assert.equal(t.game.map.name,['','The Divide','Cross Current'][round]);}
  }assert.equal(t.screen,'playing');assert.equal(t.game.round,1);assert.equal(t.game.scores[0],0);
});
check('full-bleed views keep controls at each player bottom in portrait and landscape',()=>{
  const {t,sandbox,document}=harness();for(const [w,h] of [[390,844],[844,390],[320,568],[1024,768]])for(const mode of ['solo','duel','coop'])for(const face of [true,false]){
    sandbox.innerWidth=w;sandbox.innerHeight=h;document.getElementById('tabletop').checked=face;t.start(mode);
    if(mode!=='solo'&&face)assert(Math.abs(Math.abs(t.views[0].rotation-t.views[1].rotation)-Math.PI)<1e-8);
    assert.equal(t.views.reduce((sum,v)=>sum+v.w*v.h,0),w*h);
    for(const v of t.views){const b=v.board,pad=t.ui[v.id].pad;
      assert.equal(b.x,0);assert.equal(b.y,0);assert.equal(b.w,v.w);assert.equal(b.h,v.h);
      assert.equal(parseFloat(pad.style.left)+b.padSize/2,v.w/2);
      const top=parseFloat(pad.style.top),bottom=top+b.padSize;
      assert(top>v.h/2);assert(bottom<=v.h-28&&bottom>=v.h-64);
      assert(b.focusY+t.world.r*b.scale+20<top,'particle has clear space above the controls');
      assert(parseFloat(t.ui[v.id].caption.style.top)>bottom);
    }
  }
});
check('cameras keep particles above the controls even at world edges',()=>{
  const {t}=harness();assert(t.world.w>1000&&t.world.h>1000);
  for(const [w,h] of [[390,844],[844,390],[320,568],[1024,768],[2560,720]])for(const n of [1,2])for(const v of t.makeViews(w,h,n,true)){
    v.board=t.boardFor(v);const center=t.cameraFor(v,{x:t.world.w/2,y:t.world.h/2});
    assert(center.w<t.world.w&&center.h<t.world.h);
    const moved=t.cameraFor(v,{x:t.world.w/2+20,y:t.world.h/2+20});assert(moved.x>center.x);assert(moved.y>=center.y);
    for(const r of [{x:0,y:0},{x:t.world.w,y:t.world.h}]){const c=t.cameraFor(v,r);assert(Math.abs((r.x-c.x)*c.scale-v.w/2)<1e-8);assert(Math.abs((r.y-c.y)*c.scale-v.board.focusY)<1e-8);assert((r.y-c.y)*c.scale+t.world.r*c.scale<v.board.padY-v.board.padSize/2);}
  }
  t.start('duel');assert.notEqual(t.cameraFor(t.views[0],t.game.riders[0]).x,t.cameraFor(t.views[1],t.game.riders[1]).x);
});
check('thumb marker tracks and clamps touch while the particle stays clear in both orientations',()=>{
  for(const [w,h] of [[390,844],[844,390]]){
    const harn=harness();const {t,sandbox}=harn;sandbox.innerWidth=w;sandbox.innerHeight=h;t.start('duel');
    for(const v of t.views){
      const pad=t.ui[v.id].pad,b=v.board,size=b.padSize;
      pad.getBoundingClientRect=()=>({left:0,top:0,width:size,height:size});
      const r=t.game.riders[v.id];
      for(const [dx,dy] of [[0,0],[2,1],[20,-12],[300,-200]]){
        const finger=harn.touch(40+v.id,pad,size/2+dx,size/2+dy);
        harn.dispatch('touchstart',pad,{touches:[finger],changedTouches:[finger]});
        const [lx,ly]=t.ui[v.id].knob.style.transform.match(/-?[\d.]+(?=px)/g).map(Number);
        const px=lx*Math.cos(v.rotation)-ly*Math.sin(v.rotation),py=lx*Math.sin(v.rotation)+ly*Math.cos(v.rotation);
        const limit=t.padTravel(size),factor=Math.min(1,limit/(Math.hypot(dx,dy)||1));
        assert(Math.abs(px-dx*factor)<1e-7);assert(Math.abs(py-dy*factor)<1e-7);
        assert(Math.hypot(px,py)+size*.17<size/2,'entire thumb marker stays inside the circle');
        for(const [x,y] of [[r.x,r.y],[7,7],[t.world.w-7,t.world.h-7]]){
          const c=t.cameraFor(v,{...r,x,y});
          assert(Math.abs((x-c.x)*c.scale-b.focusX)<1e-7);assert(Math.abs((y-c.y)*c.scale-b.focusY)<1e-7);
          assert((y-c.y)*c.scale+t.world.r*c.scale<b.padY-size/2-20);
        }
        const heldCamera=t.cameraFor(v,r);
        harn.dispatch('touchend',pad,{touches:[],changedTouches:[finger]});
        assert.deepEqual(t.cameraFor(v,r),heldCamera,'releasing the control must not move the camera');assert.equal(t.inputs[v.id].aimX,0);
      }
    }
  }
});
check('maximum speed increases while continuous collision still catches a wall',()=>{
  const {t}=harness();t.start('duel');live(t);const r=t.game.riders[0];r.angle=0;t.inputs[0].x=1;
  const before=r.x;t.simulate(.5);assert(Math.abs(r.x-before-90)<1e-5);assert.equal(r.speed,180);
  Object.assign(r,{x:t.world.w-8,y:500,trailX:t.world.w-8,trailY:500});t.step(1/120);assert.equal(r.alive,false);
});
check('controls and minimaps fit inside rotated phone safe areas',()=>{
  const {t}=harness();for(const [w,h,safe] of [[390,844,{left:0,top:44,width:390,height:766}],[844,390,{left:44,top:0,width:766,height:369}],[320,568,{left:0,top:20,width:320,height:528}]]){
    for(const n of [1,2])for(const face of [true,false])for(const v of t.makeViews(w,h,n,face)){
      v.safe=t.safeFor(v,safe);v.hudTop=24;const m=t.minimapFor(v),b=t.boardFor(v);assert.equal(m.w/m.h,t.world.w/t.world.h);
      const c=Math.cos(v.rotation),s=Math.sin(v.rotation);
      const half=b.padSize/2;
      assert(b.padY>v.h/2);assert(b.focusY+t.world.r*b.scale+20<b.padY-half);
      for(const [x,y] of [[m.x,m.y],[m.x+m.w,m.y+m.h],[b.padX-half,b.padY-half],[b.padX+half,b.padY+half]]){const px=v.cx+(x-v.w/2)*c-(y-v.h/2)*s,py=v.cy+(x-v.w/2)*s+(y-v.h/2)*c;assert(px>=safe.left-1e-8&&px<=safe.left+safe.width+1e-8);assert(py>=safe.top-1e-8&&py<=safe.top+safe.height+1e-8);}
    }
  }
});
check('wide trails have matching collision width and co-op cameras follow survivors',()=>{
  const {t}=harness();t.start('duel');const p=t.game.riders[1];p.trailX=500;p.trailY=400;p.distance=100;t.addTrail(p,700,400);
  assert(t.trailHit(t.game.riders[0],550,412,600,412));assert(!t.trailHit(t.game.riders[0],550,415,600,415));
  t.start('coop');assert.equal(t.followedRider(0).id,0);t.game.riders[0].alive=false;assert.equal(t.followedRider(0).id,1);
  t.render();t.game.riders[1].alive=false;assert.equal(t.followedRider(0).id,0);t.render();
});
check('touch release outside pad resets only its own finger, including missing pointerup',()=>{
  const h=harness();const {t}=h;t.start('duel');const a=h.touch(0,t.ui[0].pad),b=h.touch(2,t.ui[1].pad,50,1);
  h.dispatch('pointerdown',t.ui[0].pad,{pointerId:41,clientX:99,clientY:50});assert.equal(t.inputs[0].pointer,null);
  h.dispatch('touchstart',a.target,{touches:[a],changedTouches:[a]});h.dispatch('touchstart',b.target,{touches:[a,b],changedTouches:[b]});assert(t.inputs[0].x<-.99);assert(t.inputs[1].y<-.99);
  h.dispatch('touchend',h.element(),{touches:[b],changedTouches:[a]});assert.equal(t.inputs[0].x,0);assert.equal(t.ui[0].knob.style.transform,'');assert(t.inputs[1].y<-.99);
  h.dispatch('touchcancel',h.element(),{touches:[],changedTouches:[b]});assert.equal(t.inputs[1].y,0);
});
check('dead zone, speed, face-to-face rotation, and missed-end recovery',()=>{
  const h=harness();const {t}=h;t.start('duel');const a=h.touch(1,t.ui[1].pad,52,50);h.dispatch('touchstart',a.target,{touches:[a],changedTouches:[a]});assert.equal(t.inputs[1].x,0);
  a.clientX=67;h.dispatch('touchmove',a.target,{touches:[a],changedTouches:[a]});assert(t.inputs[1].x>.2&&t.inputs[1].x<.6);
  const b=h.touch(1,t.ui[0].pad,99,50);h.dispatch('touchstart',b.target,{touches:[b],changedTouches:[b]});assert.equal(t.inputs[1].x,0);assert(t.inputs[0].x<-.99);
  t.pauseGame();t.resume();h.dispatch('touchmove',b.target,{touches:[b],changedTouches:[b]});assert.equal(t.inputs[0].x,0);
});
check('pointer fallback, failed capture, and releases outside controls',()=>{
  const h=harness(false);const {t}=h;t.start('solo');const pad=t.ui[0].pad;pad.captureFails=true;
  h.dispatch('pointerdown',pad,{pointerId:9,pointerType:'mouse',clientX:99,clientY:50});assert(t.inputs[0].x>.99);
  h.dispatch('pointermove',h.element(),{pointerId:9,pointerType:'mouse',clientX:1,clientY:50});assert(t.inputs[0].x<-.99);
  h.dispatch('pointerup',h.element(),{pointerId:9,buttons:0});assert.equal(t.inputs[0].x,0);
});
check('pause, visibility loss, blur and page exit clear input and freeze play',()=>{
  for(const type of ['blur','pagehide','visibilitychange']){const h=harness();h.t.start('solo');h.t.inputs[0].x=1;h.t.keys.add('KeyW');if(type==='visibilitychange'){h.document.hidden=true;h.documentEvents.get(type).fn({});}else h.windowEvents.get(type)({});assert.equal(h.t.screen,'paused');assert.equal(h.t.inputs[0].x,0);assert.equal(h.t.keys.size,0);const before=h.t.game.countdown;h.t.step(1);assert.equal(h.t.game.countdown,before);}
});
check('browser gestures stay suppressed only during active play',()=>{
  const h=harness();h.t.start('solo');for(const type of ['contextmenu','selectstart','dblclick','gesturestart','touchstart','touchmove','touchend','touchcancel'])assert(h.dispatch(type,null,{touches:[],changedTouches:[]}).prevented);h.t.pauseGame();assert(!h.dispatch('touchstart',null,{touches:[],changedTouches:[]}).prevented);
});
console.log('All game and input checks passed.');
module.exports={harness};
