(() => {
  'use strict';
  const N=window.NeonWifi,$=id=>document.getElementById(id),canvas=$('arena'),ctx=canvas.getContext('2d',{alpha:false});
  const PREFIX='neon-trails-wifi-v1-',ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',SNAPSHOT_MS=1000/15;
  let peer=null,link=null,room=null,isHost=false,me=null,roomCode='',players=[],connections=new Map(),generation=0,connectionSerial=0;
  let state=null,previous=null,stateAt=0,serial=-1,inputSeq=0,lastInputAt=0,lastPingAt=0,lastPublishAt=0,lastHostSeen=0,rtt=0;
  let connected=false,connectDeadline=0,lastTick=performance.now(),accumulator=0,spectating=null,scoreKey='',wakeLock=null;
  let pointer=null,touch=null,steering={x:0,y:0},keys=new Set(),geometry=null,notice='';
  const nativeTouch='ontouchstart' in window;
  function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
  function status(message,error=false){text('status',message);$('status').classList.toggle('error',error);}
  function newCode(){const values=crypto.getRandomValues(new Uint8Array(6));return Array.from(values,n=>ALPHABET[n%ALPHABET.length]).join('');}
  function validCode(code){return /^[A-HJ-NP-Z2-9]{6}$/.test(code);}
  function rosterOK(list){return Array.isArray(list)&&list.length>=1&&list.length<=N.MAX_PLAYERS&&list.every(p=>p&&Number.isInteger(p.id)&&p.id>=0&&p.id<N.MAX_PLAYERS&&typeof p.name==='string'&&p.name.length<=16&&typeof p.ready==='boolean'&&typeof p.connected==='boolean')&&new Set(list.map(p=>p.id)).size===list.length;}
  function send(connection,message){
    if(!connection?.open)return false;
    if(message.t==='state'&&(connection.bufferSize>0||connection.dataChannel?.bufferedAmount>65536))return false;
    try{connection.send(message);return true;}catch{return false;}
  }
  function keepAwake(){if(!wakeLock&&!document.hidden&&navigator.wakeLock)navigator.wakeLock.request('screen').then(lock=>{if(!connected){lock.release().catch(()=>{});return;}wakeLock=lock;lock.addEventListener('release',()=>wakeLock=null);}).catch(()=>{});}
  function clearSteering(){
    const old=pointer;pointer=null;touch=null;steering={x:0,y:0};keys.clear();$('knob').style.transform='';$('pad').classList.remove('held');
    if(old!==null)try{if($('pad').hasPointerCapture(old))$('pad').releasePointerCapture(old);}catch{}
    if(connected)transmitInput();
  }
  function reset(message='Create a room, or enter your host’s six-character code.',error=false){
    generation++;connected=false;connectDeadline=0;const oldPeer=peer;peer=null;link=null;room=null;connections.clear();if(oldPeer)oldPeer.destroy();
    if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}isHost=false;me=null;players=[];state=previous=null;serial=-1;inputSeq=0;spectating=null;scoreKey='';notice='';accumulator=0;clearSteering();
    $('game').hidden=true;$('setup').hidden=false;$('entry').hidden=false;$('lobby').hidden=true;$('retry').hidden=!error;$('create').disabled=$('join').disabled=false;document.body.style.overflow='';status(message,error);
  }
  function fail(message){reset(message,true);}
  function paintLobby(){
    if(!connected||state)return;
    $('entry').hidden=true;$('lobby').hidden=false;$('setup').hidden=false;$('game').hidden=true;$('retry').hidden=true;
    text('room-code',roomCode);text('player-count',players.length+' / 10 players');text('connection',isHost?'You are hosting':rtt?'Connected · '+rtt+' ms':'Connected');
    const roster=$('roster');roster.replaceChildren();
    for(let i=0;i<N.MAX_PLAYERS;i++){
      const p=players[i],li=document.createElement('li'),dot=document.createElement('span'),name=document.createElement('span'),ready=document.createElement('span');
      dot.className='slot';name.className='name';ready.className='ready-status';
      if(p){li.style.setProperty('--slot-color',N.COLORS[p.id]);name.textContent=p.name+(p.id===me?' (you)':'');ready.textContent=p.id===0?'HOST':p.ready?'READY':'…';}
      else{li.className='empty';name.textContent='Open spot';}
      li.append(dot,name,ready);roster.append(li);
    }
    $('start').hidden=!isHost;$('start').disabled=!room?.canStart();$('ready').hidden=isHost;
    const own=players.find(p=>p.id===me);text('ready',own?.ready?'Ready ✓ · Tap to undo':"I'm ready");
    text('lobby-hint',isHost?'Keep this page open. Start when everyone is ready; no one can join during a match.':'Tap ready when you’re set. Keep this page open while you play.');
    status(players.length<2?'Share the code or invite link with friends on your Wi-Fi.':isHost?(room.canStart()?'Everyone is ready. Start the match.':'Waiting for everyone to tap ready.'):'Waiting for the host to start.');
  }
  function acceptState(packet){
    if(!N.validState(packet)||packet.serial<=serial)return;
    serial=packet.serial;lastHostSeen=performance.now();
    const changedRound=state?.round!==packet.state.round;
    previous=changedRound?packet.state:state||packet.state;state=packet.state;state.paused=packet.paused;stateAt=performance.now();
    if(changedRound){clearSteering();spectating=null;}
    if(!$('setup').hidden){$('setup').hidden=true;$('game').hidden=false;document.body.style.overflow='hidden';resize();keepAwake();}
    paintHUD();
  }
  function hostChanged(){
    if(!room)return;players=room.roster();
    if(room.game){const packet=room.packet();acceptState(packet);}
    else{state=previous=null;scoreKey='';$('setup').hidden=false;$('game').hidden=true;document.body.style.overflow='';paintLobby();}
  }
  function connect(create){
    if(peer)return;
    const name=N.cleanName($('name').value),code=create?newCode():$('code').value.toUpperCase().replace(/\s/g,'');
    if(!validCode(code)){status('Enter the six-character code shown on the host’s screen.',true);return;}
    if(typeof window.Peer!=='function'){status('The connection service could not load. Check your internet connection and reload.',true);$('retry').hidden=false;return;}
    isHost=create;roomCode=code;connectDeadline=performance.now()+25000;$('create').disabled=$('join').disabled=true;$('retry').hidden=true;status(create?'Creating your room…':'Finding room '+code+'…');
    const gen=++generation;
    // Allocate both host and guest IDs locally, avoiding a separate ID-service request.
    // LAN gameplay uses direct ICE candidates; no relay is configured for this mode.
    const peerId=PREFIX+(create?code:newCode());
    try{peer=new Peer(peerId,{debug:1,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]}});}catch{fail('This browser could not start multiplayer. Try a current Safari, Chrome or Firefox browser.');return;}
    peer.on('open',()=>{
      if(gen!==generation)return;
      if(create){
        connected=true;connectDeadline=0;me=0;
        room=new N.HostRoom(name,{send:(key,m)=>send(connections.get(key),m),close:key=>{const c=connections.get(key);connections.delete(key);if(c)setTimeout(()=>c.close(),250);},changed:hostChanged});
        players=room.roster();paintLobby();keepAwake();
      }else{
        status('Connecting to the host…');
        // BinaryPack chunks large ten-player snapshots; PeerJS JSON channels reject them.
        link=peer.connect(PREFIX+code,{reliable:true,serialization:'binary',metadata:{v:N.VERSION,name}});attachGuest(link,gen);
      }
    });
    peer.on('connection',connection=>{
      if(gen!==generation||!create||!room){connection.close();return;}
      const key=String(++connectionSerial);connections.set(key,connection);let joined=false;
      const timeout=setTimeout(()=>{if(gen===generation&&!joined){connections.delete(key);connection.close();}},12000);
      connection.on('open',()=>{if(gen!==generation)return;clearTimeout(timeout);joined=room.join(key,connection.metadata?.name,connection.metadata?.v)!==null;});
      connection.on('data',m=>{if(gen===generation&&joined)room.receive(key,m);});
      const closed=()=>{clearTimeout(timeout);if(gen!==generation)return;if(joined)room.disconnect(key);else connections.delete(key);};
      connection.on('close',closed);connection.on('error',closed);
    });
    peer.on('error',error=>{
      if(gen!==generation)return;
      if(connected&&create&&players.length>1&&error.type!=='browser-incompatible'){status('Room service interrupted. Players already connected can keep playing.');return;}
      const message=error.type==='unavailable-id'?'That room code is already in use. Try creating a new room.':error.type==='peer-unavailable'?'Room not found. Check the code and make sure the host is still on this page.':'Could not connect. Use the same Wi-Fi, check internet access, and avoid guest networks that isolate devices.';
      fail(message);
    });
    peer.on('disconnected',()=>{if(gen===generation&&connected)status('Room service disconnected. Existing connections can continue; new players may need a new room.');});
  }
  function attachGuest(connection,gen){
    connection.on('open',()=>{if(gen===generation)status('Connected to the host. Joining the room…');});
    connection.on('data',m=>{
      if(gen!==generation||!m||typeof m!=='object')return;
      if(m.t==='rejected'&&typeof m.reason==='string'){fail(m.reason.slice(0,200));return;}
      if(m.t==='welcome'&&m.v===N.VERSION&&rosterOK(m.players)&&m.players.some(p=>p.id===m.id)&&m.id!==0){
        me=m.id;players=m.players;connected=true;connectDeadline=0;lastHostSeen=performance.now();paintLobby();keepAwake();return;
      }
      if(!connected)return;
      if(m.t==='lobby'&&m.v===N.VERSION&&rosterOK(m.players)){
        lastHostSeen=performance.now();players=m.players;state=previous=null;scoreKey='';$('game').hidden=true;document.body.style.overflow='';clearSteering();paintLobby();
      }
      if(m.t==='state')acceptState(m);
      if(m.t==='pong'&&Number.isFinite(m.sent)){lastHostSeen=performance.now();rtt=Math.max(0,Math.round(performance.now()-m.sent));if(!state)text('connection','Connected · '+rtt+' ms');}
    });
    connection.on('close',()=>{if(gen===generation)fail('The host closed the room or disconnected. Create or join a new room.');});
    connection.on('error',()=>{if(gen===generation)fail('Connection to the host failed. Check Wi-Fi and try joining again.');});
  }
  function currentInput(){
    let x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')),y=Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));
    if(!x&&!y)return steering;const length=Math.hypot(x,y);return {x:x/length,y:y/length};
  }
  function transmitInput(){
    if(!connected)return;const input=currentInput();if(room)room.hostInput(input.x,input.y);else send(link,{t:'input',seq:inputSeq++,x:input.x,y:input.y});lastInputAt=performance.now();
  }
  function movePad(point){
    if(!state||state.paused||!state.riders.find(r=>r.id===me)?.alive||!['live','countdown'].includes(state.phase))return;
    const b=$('pad').getBoundingClientRect(),radius=b.width*.33-2,dx=point.clientX-b.left-b.width/2,dy=point.clientY-b.top-b.height/2,length=Math.hypot(dx,dy),factor=Math.min(1,radius/(length||1)),magnitude=N.clamp((Math.min(1,length/radius)-.16)/.84,0,1);
    steering={x:dx/(length||1)*magnitude,y:dy/(length||1)*magnitude};$('knob').style.transform='translate('+(dx*factor)+'px,'+(dy*factor)+'px)';$('pad').classList.add('held');transmitInput();
  }
  function resize(){
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.75),safe=$('safe-frame').getBoundingClientRect();
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    const size=N.clamp(Math.min(w,h)*.3,94,132),x=safe.left+safe.width/2,y=safe.top+safe.height-size/2-50;
    geometry={w,h,x,y,size,focusY:(safe.top+y-size/2)/2,scale:Math.max(Math.min(w,h)/460,w/(N.W*.85),h/(N.H*.85)),safe};
    Object.assign($('pad').style,{left:x-size/2+'px',top:y-size/2+'px',width:size+'px',height:size+'px'});
    $('control-hint').style.top=y+size/2+9+'px';$('rider-status').style.top=safe.top+safe.height-18+'px';clearSteering();
  }
  function paintHUD(){
    if(!state)return;
    const own=state.players.find(p=>p.id===me),r=state.riders.find(r=>r.id===me),over=state.phase==='roundover'||state.phase==='matchover';
    document.documentElement.style.setProperty('--player',N.COLORS[me]);text('you','P'+(me+1)+' · '+(own?.name||'Rider'));text('round','ROUND '+state.round);text('alive',state.riders.filter(r=>r.alive).length+' / '+state.riders.length+' ALIVE');
    $('pad').hidden=over||state.paused||!r?.alive;$('control-hint').hidden=$('pad').hidden;$('spectate').hidden=over||state.paused||!!r?.alive;
    $('pause-game').hidden=!isHost||over||state.paused;$('paused').hidden=!state.paused||over;$('resume').hidden=!isHost;text('pause-hint',isHost?'Everyone will resume together.':'Waiting for the host to resume.');
    text('rider-status',r?.alive?'TRAIL '+r.trailLength+(r.speedFactor!==1?' · '+(r.speedFactor>1?'BOOST ':'SLOW ')+Math.ceil(r.speedLeft)+'s':''):'SPECTATING · Your next chance is next round');
    $('result').hidden=!over;
    if(over){
      $('next').hidden=!isHost||state.phase!=='roundover';$('back-lobby').hidden=!isHost||state.phase!=='matchover';
      text('result-label',state.phase==='matchover'?'MATCH COMPLETE':'ROUND '+state.round+' COMPLETE');
      const winner=state.players.find(p=>p.id===state.winner),champ=state.champions.length===1?state.players.find(p=>p.id===state.champions[0]):null;
      text('result-title',state.phase==='matchover'?(champ?champ.name+' wins!':'Match tied.'):(winner?winner.name+' survives!':'A simultaneous wipeout.'));
      text('result-hint',isHost?(state.phase==='matchover'?'Return to the lobby for a rematch or new players.':'Start the next round when everyone is ready.'):'Waiting for the host.');
      const key=JSON.stringify(state.players);if(key!==scoreKey){scoreKey=key;$('scores').replaceChildren();for(const p of [...state.players].sort((a,b)=>b.score-a.score||a.id-b.id)){
        const li=document.createElement('li'),name=document.createElement('span'),score=document.createElement('b');name.className='name';name.style.color=N.COLORS[p.id];name.textContent='P'+(p.id+1)+' '+p.name+(p.connected?'':' · LEFT');score.textContent=p.score;li.append(name,score);$('scores').append(li);
      }}
    }
    if(over||state.paused||!r?.alive){if(pointer!==null||touch!==null||keys.size||steering.x||steering.y)clearSteering();}
  }
  function drawWorld(camera,positions){
    ctx.save();ctx.scale(geometry.scale,geometry.scale);ctx.translate(-camera.x,-camera.y);ctx.fillStyle='#0b1925';ctx.fillRect(0,0,N.W,N.H);
    ctx.strokeStyle='#1b3343';ctx.lineWidth=1/geometry.scale;ctx.beginPath();
    for(let x=Math.max(0,Math.floor(camera.x/48)*48);x<=Math.min(N.W,camera.x+geometry.w/geometry.scale);x+=48){ctx.moveTo(x,Math.max(0,camera.y));ctx.lineTo(x,Math.min(N.H,camera.y+geometry.h/geometry.scale));}
    for(let y=Math.max(0,Math.floor(camera.y/48)*48);y<=Math.min(N.H,camera.y+geometry.h/geometry.scale);y+=48){ctx.moveTo(Math.max(0,camera.x),y);ctx.lineTo(Math.min(N.W,camera.x+geometry.w/geometry.scale),y);}ctx.stroke();
    ctx.fillStyle='#ff7f6815';ctx.fillRect(0,0,N.W,state.inset);ctx.fillRect(0,N.H-state.inset,N.W,state.inset);ctx.fillRect(0,state.inset,state.inset,N.H-2*state.inset);ctx.fillRect(N.W-state.inset,state.inset,state.inset,N.H-2*state.inset);
    ctx.strokeStyle=state.inset?'#ffac7c':'#4b7184';ctx.lineWidth=3;ctx.strokeRect(state.inset,state.inset,N.W-2*state.inset,N.H-2*state.inset);
    ctx.lineCap='round';ctx.lineJoin='round';
    for(const r of state.riders){const old=previous?.riders.find(p=>p.id===r.id),trail=r.alive&&old?.alive?old.trail:r.trail;if(!trail.length)continue;ctx.beginPath();ctx.moveTo(...trail[0]);for(const p of trail.slice(1))ctx.lineTo(...p);const head=positions.get(r.id);ctx.lineTo(head.x,head.y);ctx.strokeStyle=N.COLORS[r.id]+'25';ctx.lineWidth=N.TRAIL+10;ctx.stroke();ctx.strokeStyle=N.COLORS[r.id];ctx.lineWidth=N.TRAIL;ctx.stroke();ctx.strokeStyle='#eaffff80';ctx.lineWidth=2;ctx.stroke();}
    for(const p of state.pickups){const item=N.PICKUPS[p.type];ctx.fillStyle='#0b1925';ctx.strokeStyle=item.color;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(p.x-15,p.y-15,30,30,8);ctx.fill();ctx.stroke();ctx.fillStyle=item.color;ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.fillText(item.icon,p.x,p.y+4);}
    for(const r of state.riders){if(!r.alive)continue;const p=positions.get(r.id);ctx.shadowColor=N.COLORS[r.id];ctx.shadowBlur=16;ctx.fillStyle=N.COLORS[r.id];ctx.beginPath();ctx.arc(p.x,p.y,N.R,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#eaffff';ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle=N.COLORS[r.id];ctx.font='bold 10px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText('P'+(r.id+1),p.x,p.y-16);}
    ctx.restore();
  }
  function drawRadar(camera,positions){
    const {safe}=geometry,w=N.clamp(Math.min(geometry.w,geometry.h)*.25,76,120),h=w*N.H/N.W,x=safe.left+safe.width-w-14,y=safe.top+70,sx=w/N.W,sy=h/N.H;
    ctx.fillStyle='#06111cef';ctx.strokeStyle='#344e60';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x-5,y-5,w+10,h+25,8);ctx.fill();ctx.stroke();ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.translate(x,y);ctx.scale(sx,sy);
    ctx.fillStyle='#112837';ctx.fillRect(0,0,N.W,N.H);ctx.strokeStyle='#f3cfa1';ctx.lineWidth=1/sx;ctx.strokeRect(state.inset,state.inset,N.W-2*state.inset,N.H-2*state.inset);
    for(const r of state.riders){ctx.strokeStyle=N.COLORS[r.id];ctx.lineWidth=1.2/sx;ctx.beginPath();r.trail.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();if(r.alive){const p=positions.get(r.id);ctx.fillStyle=N.COLORS[r.id];ctx.beginPath();ctx.arc(p.x,p.y,(r.id===me?3.5:2.5)/sx,0,Math.PI*2);ctx.fill();}}
    ctx.fillStyle='#eafaff12';ctx.strokeStyle='#eafaffa0';ctx.lineWidth=1/sx;ctx.fillRect(camera.x,camera.y,geometry.w/geometry.scale,geometry.h/geometry.scale);ctx.strokeRect(camera.x,camera.y,geometry.w/geometry.scale,geometry.h/geometry.scale);ctx.restore();ctx.fillStyle='#88adbf';ctx.font='8px ui-monospace,monospace';ctx.textAlign='left';ctx.fillText('FULL ARENA',x,y+h+13);
  }
  function draw(now){
    if(state&&geometry&&!$('game').hidden){
      const alpha=N.clamp((now-stateAt)/SNAPSHOT_MS,0,1),positions=new Map();
      for(const r of state.riders){const old=previous?.riders.find(p=>p.id===r.id),blend=old&&old.alive&&r.alive&&!state.paused;positions.set(r.id,{x:blend?old.x+(r.x-old.x)*alpha:r.x,y:blend?old.y+(r.y-old.y)*alpha:r.y});}
      const mine=state.riders.find(r=>r.id===me),alive=state.riders.filter(r=>r.alive),follow=mine?.alive?mine:alive.find(r=>r.id===spectating)||alive[0]||mine||state.riders[0];
      if(follow){const p=positions.get(follow.id),camera={x:p.x-geometry.x/geometry.scale,y:p.y-geometry.focusY/geometry.scale};ctx.fillStyle='#080f18';ctx.fillRect(0,0,geometry.w,geometry.h);drawWorld(camera,positions);drawRadar(camera,positions);}
      notice=!isHost&&now-lastHostSeen>2500?'Waiting for host connection…':state.paused?'':state.phase==='countdown'?'STARTING IN '+Math.max(1,Math.ceil(state.countdown)):state.inset?'BOUNDARY CLOSING':mine?.alive?'':follow?'Watching P'+(follow.id+1):'';text('game-notice',notice);
    }
    requestAnimationFrame(draw);
  }
  function tick(){
    const now=performance.now(),elapsed=Math.min(.1,(now-lastTick)/1000);lastTick=now;
    if(connectDeadline&&now>connectDeadline){fail('Connection timed out. Check the room code, internet access and Wi-Fi device isolation.');return;}
    if(!connected)return;
    if(now-lastInputAt>=50)transmitInput();
    if(room){
      accumulator+=elapsed;while(accumulator>=1/60){room.tick(1/60);accumulator-=1/60;}
      if(room.game&&now-lastPublishAt>=SNAPSHOT_MS){lastPublishAt=now;room.publish();}
    }else{
      if(now-lastPingAt>=1000){send(link,{t:'ping',sent:now});lastPingAt=now;}
      if(now-lastHostSeen>12000)fail('The host stopped responding. Keep the host’s game open, then create or join a new room.');
    }
  }
  $('create').addEventListener('click',()=>connect(true));$('join').addEventListener('click',()=>connect(false));$('code').addEventListener('keydown',e=>{if(e.key==='Enter')connect(false);});
  $('ready').addEventListener('click',()=>send(link,{t:'ready',ready:!players.find(p=>p.id===me)?.ready}));
  $('start').addEventListener('click',()=>{if(room?.start()){resize();keepAwake();}});$('next').addEventListener('click',()=>room?.next());$('back-lobby').addEventListener('click',()=>room?.returnToLobby());
  $('pause-game').addEventListener('click',()=>room?.pause(true));$('resume').addEventListener('click',()=>{if(!document.hidden)room?.pause(false);});
  function leave(){if(isHost&&!confirm('Close this room for everyone?'))return;send(link,{t:'leave'});reset('You left the room. Create or join another game.');}
  $('leave').addEventListener('click',leave);$('exit-game').addEventListener('click',leave);$('retry').addEventListener('click',()=>reset());
  $('copy').addEventListener('click',async()=>{const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('room',roomCode);try{await navigator.clipboard.writeText(url.href);status('Invite copied. Share it with friends on your Wi-Fi.');}catch{status('Share room code '+roomCode+' with your friends.');}});
  $('spectate').addEventListener('click',()=>{const alive=state?.riders.filter(r=>r.alive)||[];if(alive.length)spectating=alive[(alive.findIndex(r=>r.id===(spectating??alive[0].id))+1)%alive.length].id;});
  $('pad').addEventListener('pointerdown',e=>{if(nativeTouch&&e.pointerType==='touch'||e.button!==0||pointer!==null)return;e.preventDefault();pointer=e.pointerId;try{$('pad').setPointerCapture(pointer);}catch{}movePad(e);});
  window.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;if(e.buttons===0)clearSteering();else movePad(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,e=>{if(e.pointerId===pointer)clearSteering();});
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])document.addEventListener(type,e=>{
    if($('game').hidden)return;
    if(type==='touchstart'&&touch===null){const started=Array.from(e.changedTouches).find(t=>$('pad').contains(t.target));if(started)touch=started.identifier;}
    if(touch!==null){if(e.cancelable)e.preventDefault();const active=Array.from(e.touches).find(t=>t.identifier===touch);if(active)movePad(active);else clearSteering();}
  },{passive:false});
  const controls=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
  window.addEventListener('keydown',e=>{if($('game').hidden)return;if(controls.has(e.code)){e.preventDefault();keys.add(e.code);transmitInput();}if(e.code==='Escape'&&room)room.pause(!room.paused);});
  window.addEventListener('keyup',e=>{if(controls.has(e.code)){keys.delete(e.code);transmitInput();}});
  window.addEventListener('blur',clearSteering);window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{clearSteering();if(document.hidden)room?.pause(true);else keepAwake();});
  window.addEventListener('pagehide',()=>{send(link,{t:'leave'});connected=false;peer?.destroy();});
  $('game').addEventListener('contextmenu',e=>e.preventDefault());
  const invitation=new URLSearchParams(location.search).get('room')?.toUpperCase();if(invitation&&validCode(invitation)){$('code').value=invitation;status('Choose your name, then join room '+invitation+'.');}
  resize();setInterval(tick,16);requestAnimationFrame(draw);
})();
