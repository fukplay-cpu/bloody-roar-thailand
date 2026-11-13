    // ---------- BR2 ONLINE: โหมดส่งภาพ (play-online.html?mode=stream) ----------
    // P1 รันเกมคนเดียว แล้วส่งภาพ+เสียงให้ P2 ผ่าน WebRTC (เชื่อมตรงระหว่างสองเครื่องถ้าทำได้)
    // P2 ไม่โหลดเกม: ดูวิดีโอ แล้วส่งปุ่มที่กดกลับไปให้ P1 กดแทนเป็นผู้เล่นคนที่ 2
    // การนัดเชื่อมต่อ (SDP) ส่งผ่าน Worker ห้องเดิม — ข้อความละไม่เกิน 2048 ตัวอักษร จึงแบ่งเป็นชิ้น
    var ST={on:false,hint:0,pc:null,dc:null,video:null,media:null,audioDest:null,sig:{},sigTimer:null,
      lastBits:-1,lastSend:0,seq:0,remoteSeq:-1,remoteBits:0,conn:'',route:'',rtt:0,fps:0,frames:0,
      tapNeeded:false,helloTimer:null,cv:null,raf:0,useDirect:false,connectStarted:0,
      ice:[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}]};
    (function(){
      try{
        var q=new URLSearchParams(location.search);
        ST.on=q.get('mode')==='stream'; ST.hint=parseInt(q.get('role')||'0',10)||0;
        var turn=q.get('turn'); // ใส่ TURN เองได้: &turn=turn:host:3478|user|pass
        if(turn){ var t=turn.split('|'); ST.ice.push({urls:[t[0]],username:t[1]||'',credential:t[2]||''}); }
      }catch(_){ }
      if(!ST.on) return;
      // P2 ไม่ต้องเปิดเกม (ไม่ต้องโหลดไฟล์ 528 MB)
      window.__br2Viewer=(ST.hint===2);
      // เครื่อง P1: ดักเสียงของตัวเกม (AudioWorklet ของ RetroArch) เพื่อส่งไปพร้อมภาพ
      if(!window.__br2Viewer&&window.AudioNode&&!AudioNode.prototype.__br2Hooked){
        var conn=AudioNode.prototype.connect;
        AudioNode.prototype.connect=function(dest){
          var r=conn.apply(this,arguments);
          try{
            if(dest&&this.context&&dest===this.context.destination){
              var c=this.context;
              if(!c.__br2Dest&&c.createMediaStreamDestination){ c.__br2Dest=c.createMediaStreamDestination(); ST.audioDest=c.__br2Dest; stAddAudio(); }
              if(c.__br2Dest) conn.call(this,c.__br2Dest);
            }
          }catch(_){ }
          return r;
        };
        AudioNode.prototype.__br2Hooked=true;
      }
    })();

    function stRole(){ return br2Online.role||ST.hint; }
    function stLog(m,c){ try{ log('ส่งภาพ: '+m,c||'muted'); }catch(_){ } }

    // ----- ส่งข้อความนัดเชื่อมต่อเป็นชิ้น -----
    function stSendSig(kind,desc){
      var text=typeof desc==='string'?desc:JSON.stringify(desc);
      var id=Math.random().toString(36).slice(2,8), CH=1400, n=Math.ceil(text.length/CH);
      for(var i=0;i<n;i++){
        var msg={t:'sd',p:stRole(),id:id,k:kind,i:i,n:n,d:text.substr(i*CH,CH)};
        if(JSON.stringify(msg).length>2040) stLog('ข้อความนัดเชื่อมต่อยาวเกิน (ชิ้นที่ '+i+')','err');
        lsSendRaw(msg);
      }
    }
    function stOnSigChunk(d){
      var b=ST.sig[d.id]||(ST.sig[d.id]={k:d.k,n:d.n|0,got:0,parts:[]});
      if(b.parts[d.i]===undefined){ b.parts[d.i]=String(d.d||''); b.got++; }
      if(b.got===b.n){ delete ST.sig[d.id]; var text=b.parts.join(''); try{ stOnSignal(b.k,JSON.parse(text)); }catch(e){ stLog('ข้อมูลนัดเชื่อมต่อเสีย: '+(e.message||e),'err'); } }
    }
    function stWaitIce(pc,ms){
      return new Promise(function(resolve){
        if(pc.iceGatheringState==='complete') return resolve();
        var done=false; function fin(){ if(done) return; done=true; resolve(); }
        pc.addEventListener('icegatheringstatechange',function(){ if(pc.iceGatheringState==='complete') fin(); });
        setTimeout(fin,ms);
      });
    }
    function stClosePc(){
      try{ if(ST.dc) ST.dc.close(); }catch(_){ } try{ if(ST.pc) ST.pc.close(); }catch(_){ }
      ST.pc=null; ST.dc=null; ST.conn=''; ST.route='';
    }
    function stNewPc(){
      stClosePc();
      var pc=new RTCPeerConnection({iceServers:ST.ice,bundlePolicy:'max-bundle'});
      ST.pc=pc; ST.connectStarted=Date.now();
      pc.onconnectionstatechange=function(){
        if(ST.pc!==pc) return;
        ST.conn=pc.connectionState; lsShow();
        if(pc.connectionState==='connected') stLog('เชื่อมต่อแล้ว','ok');
        if(pc.connectionState==='failed'){ stLog('เชื่อมต่อไม่สำเร็จ (เน็ตอาจไม่ยอมให้เชื่อมตรง)','err'); if(stRole()===2) stHelloSoon(1500); }
        if(pc.connectionState==='disconnected'&&stRole()===2) stHelloSoon(4000);
      };
      return pc;
    }

    // ----- P1: ส่งภาพ -----
    function stAddAudio(){
      try{ if(ST.media&&ST.audioDest){ ST.audioDest.stream.getAudioTracks().forEach(function(t){ if(ST.media.getTrackById(t.id)) return; ST.media.addTrack(t); if(ST.pc) ST.pc.addTrack(t,ST.media); }); } }catch(_){ }
    }
    function stHostMedia(){
      if(ST.media) return ST.media;
      // วาดภาพเกมลง canvas สำเนาทุกเฟรม แล้วส่ง canvas สำเนา (canvas ของตัวเกมวาดจากอีกเธรด)
      var cv=document.createElement('canvas'); cv.width=640; cv.height=480; ST.cv=cv;
      var cx=cv.getContext('2d',{alpha:false});
      function draw(){
        ST.raf=requestAnimationFrame(draw);
        if(ST.useDirect) return;
        try{
          var s=document.getElementById('screen'); if(!s||!s.width) return;
          var w=Math.min(640,s.width), h=Math.round(w*s.height/s.width)||480;
          if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
          cx.drawImage(s,0,0,w,h); ST.frames++;
        }catch(_){ }
      }
      draw();
      var ms=cv.captureStream(60);
      ST.media=ms; stAddAudio();
      // ตรวจว่าวาดสำเนาได้จริง (ไม่ดำล้วน) — ถ้าไม่ได้ ลองส่ง canvas ของเกมตรงๆ
      setTimeout(function(){
        try{
          var px=cx.getImageData(0,0,cv.width,cv.height).data, lit=0;
          for(var i=0;i<px.length;i+=4*97){ if(px[i]+px[i+1]+px[i+2]>30) lit++; }
          if(lit===0){
            var s=document.getElementById('screen');
            if(s&&s.captureStream){
              var direct=s.captureStream(60), vt=direct.getVideoTracks()[0];
              if(vt){ ST.useDirect=true; ms.getVideoTracks().forEach(function(t){ ms.removeTrack(t); t.stop(); }); ms.addTrack(vt);
                if(ST.pc){ ST.pc.getSenders().forEach(function(snd){ if(snd.track&&snd.track.kind==='video') snd.replaceTrack(vt); }); }
                stLog('วาดภาพสำเนาไม่ได้ → ส่งภาพจาก canvas ของเกมโดยตรง','muted'); }
            }
          } else stLog('จับภาพเกมได้ ('+cv.width+'×'+cv.height+')','ok');
        }catch(e){ stLog('ตรวจภาพไม่ได้: '+(e.message||e),'muted'); }
      },3000);
      return ms;
    }
    async function stHostOffer(){
      if(!ng){ stLog('ยังไม่ได้เปิดเกม — รอเกมเปิดก่อน','muted'); return; }
      var ms=stHostMedia(), pc=stNewPc();
      ms.getTracks().forEach(function(t){ var snd=pc.addTrack(t,ms);
        if(t.kind==='video'){ try{ t.contentHint='motion'; }catch(_){ }
          try{ var p=snd.getParameters(); p.degradationPreference='maintain-framerate'; if(!p.encodings||!p.encodings.length) p.encodings=[{}]; p.encodings[0].maxBitrate=3000000; p.encodings[0].maxFramerate=60; snd.setParameters(p).catch(function(){}); }catch(_){ } } });
      var dc=pc.createDataChannel('in',{ordered:false,maxRetransmits:0}); ST.dc=dc;
      dc.onmessage=function(e){ try{ stOnInput(JSON.parse(e.data)); }catch(_){ } };
      var offer=await pc.createOffer(); await pc.setLocalDescription(offer);
      await stWaitIce(pc,2500);
      stSendSig('offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
      stLog('ส่งคำขอเชื่อมต่อให้ P2 แล้ว','muted');
    }
    function stOnInput(d){
      if(typeof d.s!=='number'||d.s<=ST.remoteSeq) return;
      ST.remoteSeq=d.s; var bits=d.b|0, old=ST.remoteBits; if(bits===old) return;
      ST.remoteBits=bits;
      for(var i=0;i<LS_BTN.length;i++){ var m=1<<i; if((old^bits)&m){
        try{ if(bits&m) ng.pressDown({button:LS_BTN[i],player:2}); else ng.pressUp({button:LS_BTN[i],player:2}); }catch(_){ } } }
    }

    // ----- P2: รับภาพ -----
    function stViewerUi(){
      try{ var ld=document.getElementById('loader'); if(ld) ld.classList.add('hidden'); }catch(_){ }
      try{ document.body.classList.add('running'); }catch(_){ }
      try{ if(typeof buildPad==='function') buildPad(); }catch(_){ }
      try{ if(typeof fit==='function'){ fit(); setTimeout(fit,200); } }catch(_){ }
      var v=document.createElement('video'); v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); v.autoplay=true; v.muted=true;
      v.style.cssText='position:fixed;z-index:2;background:#000;object-fit:contain;pointer-events:none';
      document.body.appendChild(v); ST.video=v;
      function place(){ var s=document.getElementById('screen'); if(!s) return; var r=s.getBoundingClientRect();
        v.style.left=r.left+'px'; v.style.top=r.top+'px'; v.style.width=r.width+'px'; v.style.height=r.height+'px'; }
      place(); setInterval(place,300); window.addEventListener('resize',function(){ setTimeout(place,50); });
      var tap=document.createElement('button'); tap.type='button'; tap.textContent='🔊 แตะเพื่อเปิดเสียง';
      tap.style.cssText='position:fixed;z-index:99998;left:50%;top:40%;transform:translateX(-50%);padding:10px 16px;border-radius:12px;border:1px solid #64748b;background:#101722f0;color:#fff;font:15px -apple-system,sans-serif;display:none';
      tap.addEventListener('click',function(){ v.muted=false; v.play().catch(function(){}); tap.style.display='none'; });
      document.body.appendChild(tap); ST.tap=tap;
      setInterval(function(){ // นับเฟรมที่ได้รับ เพื่อแสดงสถานะ
        try{ if(v.getVideoPlaybackQuality){ var q=v.getVideoPlaybackQuality(); ST.fps=q.totalVideoFrames-(ST.lastTotal||0); ST.lastTotal=q.totalVideoFrames; } }catch(_){ }
      },1000);
      setInterval(stSendInput,100); // ส่งซ้ำเผื่อหาย
    }
    function stHelloSoon(ms){ clearTimeout(ST.helloTimer); ST.helloTimer=setTimeout(stHello,ms||0); }
    function stHello(){
      if(stRole()!==2) return;
      if(ST.pc&&(ST.pc.connectionState==='connected'||ST.pc.connectionState==='connecting'||(ST.pc.connectionState==='new'&&Date.now()-ST.connectStarted<8000))) { stHelloSoon(3000); return; }
      lsSendRaw({t:'sh',p:2,v:1}); stHelloSoon(4000);
    }
    async function stViewerAnswer(offer){
      var pc=stNewPc();
      pc.ontrack=function(e){
        var v=ST.video; if(!v) return;
        var ms=e.streams&&e.streams[0]; if(!ms){ ms=v.srcObject||new MediaStream(); ms.addTrack(e.track); }
        if(v.srcObject!==ms) v.srcObject=ms;
        try{ if('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint=0; }catch(_){ }
        try{ if('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget=0; }catch(_){ }
        v.play().catch(function(){});
        if(e.track.kind==='audio'&&ST.tap) ST.tap.style.display='';
      };
      pc.ondatachannel=function(e){ ST.dc=e.channel; ST.dc.onopen=function(){ ST.lastBits=-1; stSendInput(); }; };
      await pc.setRemoteDescription(offer);
      var ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
      await stWaitIce(pc,2500);
      stSendSig('answer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
    }
    function stSendInput(){
      if(stRole()!==2) return;
      var b=lsBits(), now=performance.now();
      if(b===ST.lastBits&&now-ST.lastSend<90) return;
      ST.lastBits=b; ST.lastSend=now; var msg={b:b,s:++ST.seq};
      if(ST.dc&&ST.dc.readyState==='open'){ try{ ST.dc.send(JSON.stringify(msg)); return; }catch(_){ } }
      lsSendRaw({t:'si',p:2,b:b,s:msg.s}); // สำรอง: ผ่าน Worker
    }

    // ----- ข้อความจากห้อง -----
    function stOnSignal(kind,desc){
      if(kind==='offer'&&stRole()===2){ stViewerAnswer(desc).catch(function(e){ stLog('ตอบรับไม่สำเร็จ: '+(e.message||e),'err'); stHelloSoon(2000); }); }
      else if(kind==='answer'&&stRole()===1&&ST.pc){ ST.pc.setRemoteDescription(desc).catch(function(e){ stLog('รับคำตอบไม่สำเร็จ: '+(e.message||e),'err'); }); }
    }
    function stOnMessage(d){
      if(d.t==='sd'){ stOnSigChunk(d); return true; }
      if(d.t==='sh'){ if(stRole()===1) stHostOffer().catch(function(e){ stLog('สร้างการเชื่อมต่อไม่สำเร็จ: '+(e.message||e),'err'); }); return true; }
      if(d.t==='si'){ if(stRole()===1) stOnInput(d); return true; }
      if(d.t==='rdy'||d.t==='i'){ LS.error='⚠️ อีกเครื่องเลือก "โหมดล็อกเฟรม"\nทั้งสองเครื่องต้องเลือกโหมดเดียวกันในหน้าห้อง'; lsShow(); return true; }
      return false;
    }
    function stShow(){
      var r=stRole(); if(!r){ br2Status('ห้อง '+br2Online.room+' · กำลังเชื่อมต่อ…',false); return; }
      if(LS.error){ br2Status('ห้อง '+br2Online.room+' · P'+r+'\n'+LS.error,false); return; }
      var ping=' · ping '+Math.round(ST.rtt||LS.rtt)+' ms', route=ST.route?(' · '+ST.route):'';
      if(r===1){
        if(!ng){ br2Status('📺 โหมดส่งภาพ · คุณคือ P1 (รันเกม)\nกด "เล่นต่อ" หรือเลือกไฟล์เกม',false); return; }
        if(ST.conn==='connected') br2Status('📺 P1 ส่งภาพอยู่'+ping+route,true);
        else br2Status('📺 P1 · รอ P2 เชื่อมต่อ…'+(ST.conn?' ('+ST.conn+')':''),false);
      } else {
        if(ST.conn==='connected') br2Status('📺 P2 รับภาพ'+ping+route+(ST.fps?' · '+ST.fps+' fps':''),true);
        else if(ST.conn==='failed') br2Status('📺 P2 · เชื่อมต่อตรงไม่ได้\nเน็ตมือถืออาจบล็อก — ลองใช้ Wi-Fi (กำลังลองใหม่…)',false);
        else br2Status('📺 โหมดส่งภาพ · คุณคือ P2\nกำลังเชื่อมต่อกับ P1…'+(ST.conn?' ('+ST.conn+')':''),false);
      }
    }
    async function stStats(){
      var pc=ST.pc; if(!pc||pc.connectionState!=='connected') return;
      try{
        var rep=await pc.getStats(), pair=null, cands={};
        rep.forEach(function(s){ if(s.type==='candidate-pair'&&s.state==='succeeded'&&(s.nominated||s.selected)) pair=s; if(s.type==='local-candidate'||s.type==='remote-candidate') cands[s.id]=s; });
        if(pair){ if(pair.currentRoundTripTime) ST.rtt=pair.currentRoundTripTime*1000;
          var lc=cands[pair.localCandidateId], rc=cands[pair.remoteCandidateId];
          var relay=(lc&&lc.candidateType==='relay')||(rc&&rc.candidateType==='relay');
          ST.route=relay?'ผ่านเซิร์ฟเวอร์':'เชื่อมตรง'; }
      }catch(_){ }
    }
    function stStart(){
      stLog('เริ่มโหมดส่งภาพ (P'+(ST.hint||'?')+')','ok');
      if(window.__br2Viewer) stViewerUi();
      setInterval(function(){ stStats(); lsShow(); },1000);
      stHelloSoon(800);
    }
