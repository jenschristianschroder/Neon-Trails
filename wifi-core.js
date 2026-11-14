(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NeonWifi=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION=1,MAX_PLAYERS=10,W=2200,H=1600,R=7,TRAIL=12,SPEED=180,CELL=48;
  const COLORS=['#4ee9ef','#ff977e','#b79aff','#ffda79','#8ff0aa','#ff83c7','#79b9ff','#ffb75e','#d1ed67','#efbfff'];
  const PICKUPS={long:{icon:'L+',color:'#8ff0aa'},short:{icon:'L−',color:'#df9fff'},fast:{icon:'S+',color:'#ffe18b'},slow:{icon:'S−',color:'#82b8ff'}};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const cleanName=value=>(typeof value==='string'?value:'').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,16)||'Rider';
  const validInput=m=>m&&Number.isSafeInteger(m.seq)&&m.seq>=0&&Number.isFinite(m.x)&&Number.isFinite(m.y)&&Math.abs(m.x)<=1&&Math.abs(m.y)<=1;
  function distanceToSegment(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(px-ax-dx*t,py-ay-dy*t);}
  const orient=(ax,ay,bx,by,cx,cy)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  function segmentDistance(ax,ay,bx,by,cx,cy,dx,dy){
    if(orient(ax,ay,bx,by,cx,cy)*orient(ax,ay,bx,by,dx,dy)<0&&orient(cx,cy,dx,dy,ax,ay)*orient(cx,cy,dx,dy,bx,by)<0)return 0;
    return Math.min(distanceToSegment(ax,ay,cx,cy,dx,dy),distanceToSegment(bx,by,cx,cy,dx,dy),distanceToSegment(cx,cy,ax,ay,bx,by),distanceToSegment(dx,dy,ax,ay,bx,by));
  }
  function buckets(ax,ay,bx,by,padding=0){const result=[];for(let y=Math.floor((Math.min(ay,by)-padding)/CELL);y<=Math.floor((Math.max(ay,by)+padding)/CELL);y++)for(let x=Math.floor((Math.min(ax,bx)-padding)/CELL);x<=Math.floor((Math.max(ax,bx)+padding)/CELL);x++)result.push(x+','+y);return result;}
  class Arena{
    constructor(players,random=Math.random){
      if(players.length<2||players.length>MAX_PLAYERS||new Set(players.map(p=>p.id)).size!==players.length)throw Error('An arena needs 2–10 different players.');
      this.random=random;this.players=players.map(p=>({id:p.id,name:cleanName(p.name),score:0,connected:true}));this.round=0;this.nextRound();
    }
    nextRound(){
      this.round++;this.time=0;this.countdown=3;this.phase='countdown';this.inset=0;this.winner=null;this.champions=[];this.hash=new Map();this.pickups=[];this.pickupQueue=[];
      const connected=this.players.filter(p=>p.connected),offset=(this.round-1)*.31;
      this.riders=connected.map((p,i)=>{
        const a=offset+Math.PI*2*i/connected.length,x=W/2+Math.cos(a)*W*.34,y=H/2+Math.sin(a)*H*.34;
        return {id:p.id,x,y,angle:Math.atan2(H/2-y,W/2-x)+.4,alive:true,speed:0,distance:0,trailX:x,trailY:y,segments:[],trailLength:520,speedFactor:1,speedUntil:0};
      });
      for(let i=0;i<12;i++)this.spawnPickup(Object.keys(PICKUPS)[i%4]);
    }
    wall(x,y,padding=R){return x<this.inset+padding||x>W-this.inset-padding||y<this.inset+padding||y>H-this.inset-padding;}
    addTrail(r,x,y){
      const segment={ax:r.trailX,ay:r.trailY,bx:x,by:y,owner:r.id,end:r.distance,start:r.distance-Math.hypot(x-r.trailX,y-r.trailY)};
      segment.keys=buckets(segment.ax,segment.ay,x,y);
      for(const key of segment.keys){if(!this.hash.has(key))this.hash.set(key,[]);this.hash.get(key).push(segment);}
      r.segments.push(segment);r.trailX=x;r.trailY=y;
    }
    trimTrail(r){
      const cutoff=r.distance-r.trailLength;
      while(r.segments.length&&r.segments[0].end<=cutoff){
        const old=r.segments.shift();for(const key of old.keys){const b=this.hash.get(key);if(!b)continue;const i=b.indexOf(old);if(i>=0)b.splice(i,1);if(!b.length)this.hash.delete(key);}
      }
      const first=r.segments[0];if(first&&first.start<cutoff){const f=(cutoff-first.start)/(first.end-first.start);first.ax+=(first.bx-first.ax)*f;first.ay+=(first.by-first.ay)*f;first.start=cutoff;}
    }
    trailHit(r,ax,ay,bx,by,padding=R+TRAIL/2){
      const seen=new Set();for(const key of buckets(ax,ay,bx,by,padding))for(const seg of this.hash.get(key)||[]){
        if(seen.has(seg))continue;seen.add(seg);if(seg.owner===r.id&&r.distance-seg.end<25)continue;
        if(segmentDistance(ax,ay,bx,by,seg.ax,seg.ay,seg.bx,seg.by)<=padding)return true;
      }return false;
    }
    spawnPickup(type){
      for(let i=0;i<50;i++){
        const gap=this.inset+50,x=gap+this.random()*(W-gap*2),y=gap+this.random()*(H-gap*2);
        if(this.wall(x,y,35)||this.riders.some(r=>r.alive&&Math.hypot(r.x-x,r.y-y)<70)||this.pickups.some(p=>Math.hypot(p.x-x,p.y-y)<70)||this.trailHit({id:-1},x,y,x,y,25))continue;
        this.pickups.push({type,x,y});return true;
      }return false;
    }
    applyPickup(r,type){
      if(type==='long'||type==='short'){r.trailLength=clamp(r.trailLength+(type==='long'?180:-180),180,1100);this.trimTrail(r);}
      else{r.speedFactor=type==='fast'?1.35:.7;r.speedUntil=this.time+10;}
    }
    disconnect(id){
      const p=this.players.find(p=>p.id===id);if(p)p.connected=false;
      const r=this.riders.find(r=>r.id===id);if(r){r.alive=false;r.speed=0;}
      if(this.phase==='live'||this.phase==='countdown')this.finishIfNeeded();
      else if(this.phase==='roundover'&&this.players.filter(p=>p.connected).length<2){this.phase='matchover';this.champions=this.players.filter(p=>p.connected).map(p=>p.id);}
    }
    finishIfNeeded(){
      const alive=this.riders.filter(r=>r.alive);if(alive.length>1)return;
      this.winner=alive[0]?.id??null;if(this.winner!==null)this.players.find(p=>p.id===this.winner).score++;
      const connected=this.players.filter(p=>p.connected),best=Math.max(...this.players.map(p=>p.score));
      this.phase=best>=3||this.round>=15||connected.length<2?'matchover':'roundover';
      if(this.phase==='matchover')this.champions=connected.length<2?connected.map(p=>p.id):this.players.filter(p=>p.score===best).map(p=>p.id);
    }
    tick(dt,inputs){
      if(!Number.isFinite(dt)||dt<=0||dt>1/30)return;
      if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-dt);if(this.countdown===0)this.phase='live';return;}
      if(this.phase!=='live')return;
      this.time+=dt;this.inset=Math.min(H/2-65,Math.max(0,(this.time-45)*14));
      const moves=[];
      for(const r of this.riders){
        if(!r.alive)continue;if(this.time>=r.speedUntil)r.speedFactor=1;this.trimTrail(r);
        const input=inputs.get(r.id)||{x:0,y:0},magnitude=Math.min(1,Math.hypot(input.x,input.y));
        r.speed=SPEED*(.65+.35*magnitude)*r.speedFactor;
        if(magnitude>.001){const delta=Math.atan2(Math.sin(Math.atan2(input.y,input.x)-r.angle),Math.cos(Math.atan2(input.y,input.x)-r.angle));r.angle+=clamp(delta,-r.speed/19*dt,r.speed/19*dt);}
        const x=r.x+Math.cos(r.angle)*r.speed*dt,y=r.y+Math.sin(r.angle)*r.speed*dt;
        moves.push({r,ax:r.x,ay:r.y,x,y,dead:this.wall(x,y)||this.trailHit(r,r.x,r.y,x,y)});
      }
      // All movement is judged against the same frame, including simultaneous crashes.
      for(let i=0;i<moves.length;i++)for(let j=i+1;j<moves.length;j++){
        const a=moves[i],b=moves[j];if(distanceToSegment(0,0,a.ax-b.ax,a.ay-b.ay,a.x-b.x,a.y-b.y)<=R*2)a.dead=b.dead=true;
      }
      for(const m of moves){const r=m.r;r.distance+=Math.hypot(m.x-r.x,m.y-r.y);r.x=m.x;r.y=m.y;if(Math.hypot(r.x-r.trailX,r.y-r.trailY)>=6)this.addTrail(r,r.x,r.y);this.trimTrail(r);if(m.dead){r.alive=false;r.speed=0;}}
      for(let i=this.pickups.length-1;i>=0;i--){
        const p=this.pickups[i],hit=moves.filter(m=>m.r.alive&&distanceToSegment(p.x,p.y,m.ax,m.ay,m.x,m.y)<R+15).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)||a.r.id-b.r.id)[0];
        if(hit)this.applyPickup(hit.r,p.type);
        if(hit||this.wall(p.x,p.y,22)){this.pickups.splice(i,1);this.pickupQueue.push({type:p.type,at:this.time+5});}
      }
      for(let i=this.pickupQueue.length-1;i>=0;i--){const q=this.pickupQueue[i];if(this.time>=q.at){if(this.spawnPickup(q.type))this.pickupQueue.splice(i,1);else q.at=this.time+2;}}
      this.finishIfNeeded();
    }
    snapshot(){
      const n=v=>Math.round(v*10)/10;
      return {round:this.round,time:n(this.time),countdown:n(this.countdown),phase:this.phase,inset:n(this.inset),winner:this.winner,champions:this.champions.slice(),players:this.players.map(p=>({...p})),
        riders:this.riders.map(r=>({id:r.id,x:n(r.x),y:n(r.y),angle:r.angle,alive:r.alive,speed:n(r.speed),trailLength:r.trailLength,speedFactor:r.speedFactor,speedLeft:n(Math.max(0,r.speedUntil-this.time)),trail:r.segments.length?[[n(r.segments[0].ax),n(r.segments[0].ay)],...r.segments.map(s=>[n(s.bx),n(s.by)])]:[]})),pickups:this.pickups.map(p=>({type:p.type,x:n(p.x),y:n(p.y)}))};
    }
  }
  class HostRoom{
    constructor(name,{now=()=>performance.now(),send=()=>{},close=()=>{},changed=()=>{},random=Math.random}={}){
      this.now=now;this.send=send;this.close=close;this.changed=changed;this.random=random;this.players=new Map([[0,{id:0,name:cleanName(name),ready:true,connected:true}]]);this.peers=new Map();this.inputs=new Map();this.sequences=new Map();this.seen=new Map();this.game=null;this.paused=false;this.serial=0;
    }
    roster(){return [...this.players.values()].map(p=>({...p}));}
    broadcast(message){for(const key of this.peers.keys())this.send(key,message);}
    lobbyMessage(){return {t:'lobby',v:VERSION,players:this.roster()};}
    notify(){if(!this.game)this.broadcast(this.lobbyMessage());this.changed();}
    join(key,name,version){
      const reject=reason=>{this.send(key,{t:'rejected',reason});this.close(key);return null;};
      if(version!==VERSION)return reject('This game version is different. Refresh both devices.');
      if(this.game)return reject('This match has started. Join when the host returns to the lobby.');
      if(this.peers.has(key))return reject('This device is already connected.');
      if(this.players.size>=MAX_PLAYERS)return reject('Room full — all 10 places are taken.');
      let id=1;while(this.players.has(id))id++;
      this.players.set(id,{id,name:cleanName(name),ready:false,connected:true});this.peers.set(key,id);this.seen.set(id,this.now());
      this.send(key,{t:'welcome',v:VERSION,id,players:this.roster()});this.notify();return id;
    }
    receive(key,m){
      const id=this.peers.get(key);if(id===undefined||!m||typeof m!=='object')return;
      if(m.t==='ping'&&Number.isFinite(m.sent)){this.seen.set(id,this.now());this.send(key,{t:'pong',sent:m.sent});}
      if(m.t==='ready'&&!this.game&&typeof m.ready==='boolean'){this.seen.set(id,this.now());this.players.get(id).ready=m.ready;this.notify();}
      if(m.t==='input'&&validInput(m)&&m.seq>(this.sequences.get(id)??-1)){
        this.sequences.set(id,m.seq);this.seen.set(id,this.now());const length=Math.max(1,Math.hypot(m.x,m.y));this.inputs.set(id,{x:m.x/length,y:m.y/length,at:this.now()});
      }
      if(m.t==='leave')this.disconnect(key);
    }
    hostInput(x,y){const n=Math.max(1,Math.hypot(x,y));this.inputs.set(0,{x:x/n,y:y/n,at:this.now()});}
    canStart(){return !this.game&&this.players.size>=2&&[...this.players.values()].every(p=>p.ready);}
    start(){if(!this.canStart())return false;this.game=new Arena(this.roster(),this.random);this.inputs.clear();this.paused=false;this.publish();return true;}
    next(){if(!this.game||this.game.phase!=='roundover')return false;this.game.nextRound();this.inputs.clear();this.paused=false;this.publish();return true;}
    returnToLobby(){
      if(!this.game||this.game.phase!=='matchover')return false;
      this.game=null;this.paused=false;this.inputs.clear();for(const [id,p] of this.players){if(!p.connected)this.players.delete(id);else p.ready=id===0;}this.notify();return true;
    }
    pause(value){if(!this.game||!['live','countdown'].includes(this.game.phase))return;this.paused=value;this.inputs.clear();this.publish();}
    disconnect(key){
      const id=this.peers.get(key);if(id===undefined)return;this.peers.delete(key);this.inputs.delete(id);this.sequences.delete(id);this.seen.delete(id);
      if(this.game){this.players.get(id).connected=false;this.game.disconnect(id);this.publish();}else this.players.delete(id);
      this.close(key);this.notify();
    }
    tick(dt){
      const now=this.now();for(const [key,id] of [...this.peers])if(now-(this.seen.get(id)||0)>10000)this.disconnect(key);
      for(const [id,input] of this.inputs)if(now-input.at>600)this.inputs.delete(id);
      if(this.game&&!this.paused)this.game.tick(dt,this.inputs);
    }
    packet(){return {t:'state',v:VERSION,serial:++this.serial,paused:this.paused,state:this.game.snapshot()};}
    publish(){if(this.game)this.broadcast(this.packet());this.changed();}
  }
  function validState(m){
    if(!m||m.t!=='state'||m.v!==VERSION||!Number.isSafeInteger(m.serial)||typeof m.paused!=='boolean')return false;
    const s=m.state;if(!s||!['countdown','live','roundover','matchover'].includes(s.phase)||!Number.isInteger(s.round)||s.round<1||s.round>15)return false;
    if(![s.time,s.countdown,s.inset].every(Number.isFinite)||s.time<0||s.inset<0||s.inset>H/2)return false;
    const id=n=>Number.isInteger(n)&&n>=0&&n<MAX_PLAYERS,point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<W*2);
    if(!Array.isArray(s.players)||s.players.length<2||s.players.length>MAX_PLAYERS||!s.players.every(p=>p&&id(p.id)&&typeof p.name==='string'&&p.name.length<=16&&Number.isInteger(p.score)&&p.score>=0&&typeof p.connected==='boolean')||new Set(s.players.map(p=>p.id)).size!==s.players.length)return false;
    if(!Array.isArray(s.riders)||s.riders.length>MAX_PLAYERS||!s.riders.every(r=>r&&id(r.id)&&s.players.some(p=>p.id===r.id)&&[r.x,r.y,r.angle,r.speed,r.trailLength,r.speedFactor,r.speedLeft].every(Number.isFinite)&&Math.abs(r.x)<W*2&&Math.abs(r.y)<W*2&&typeof r.alive==='boolean'&&Array.isArray(r.trail)&&r.trail.length<=200&&r.trail.every(point))||new Set(s.riders.map(r=>r.id)).size!==s.riders.length)return false;
    return (s.winner===null||id(s.winner))&&Array.isArray(s.champions)&&s.champions.length<=MAX_PLAYERS&&s.champions.every(id)&&Array.isArray(s.pickups)&&s.pickups.length<=12&&s.pickups.every(p=>p&&Object.hasOwn(PICKUPS,p.type)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=W&&p.y>=0&&p.y<=H);
  }
  return {VERSION,MAX_PLAYERS,W,H,R,TRAIL,SPEED,COLORS,PICKUPS,clamp,cleanName,validInput,distanceToSegment,segmentDistance,Arena,HostRoom,validState};
});
