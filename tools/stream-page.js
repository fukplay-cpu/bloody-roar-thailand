    // ---------- BR2 ONLINE: โหมดส่งภาพ (play-online.html?mode=stream) ----------
    // P1 รันเกมคนเดียว แล้วส่งภาพ+เสียงให้ P2 ผ่าน WebRTC (เชื่อมตรงระหว่างสองเครื่องถ้าทำได้)
    // P2 ไม่โหลดเกม: ดูวิดีโอ แล้วส่งปุ่มที่กดกลับไปให้ P1 กดแทนเป็นผู้เล่นคนที่ 2
    // การนัดเชื่อมต่อ (SDP) ส่งผ่าน Worker ห้องเดิม — ข้อความละไม่เกิน 2048 ตัวอักษร จึงแบ่งเป็นชิ้น
    var ST={on:false,hint:0,pc:null,dc:null,video:null,media:null,audioDest:null,sig:{},sigTimer:null,
      lastBits:-1,lastSend:0,seq:0,remoteSeq:-1,remoteBits:0,conn:'',route:'',rtt:0,fps:0,frames:0,
      tapNeeded:false,capW:480,inCount:0,outCount:0,helloTimer:null,cv:null,raf:0,useDirect:false,connectStarted:0,
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
    // ขอ TURN จาก Worker (ถ้าตั้งค่าไว้) — ใช้ส่งต่อภาพเมื่อสองเครื่องเชื่อมตรงกันไม่ได้
    function stLoadTurn(){
      if(ST.turnP) return ST.turnP;
      ST.turnP=(async function(){
        try{
          var ctl=('AbortController' in window)?new AbortController():null; var t=setTimeout(function(){ try{ ctl&&ctl.abort(); }catch(_){ } },4000);
          var r=await fetch(new URL('/turn',br2Online.worker).href,{cache:'no-store',signal:ctl?ctl.signal:undefined}); clearTimeout(t);
          var d=await r.json();
          if(d&&Array.isArray(d.iceServers)&&d.iceServers.length){ ST.ice=ST.ice.concat(d.iceServers); ST.turnOk=true; stLog('มีเซิร์ฟเวอร์ TURN สำรอง (ใช้เมื่อเชื่อมตรงไม่ได้)','ok'); }
          else if(d&&d.configured===false){ ST.turnOk=false; stLog('ยังไม่ได้ตั้งค่า TURN ใน Worker — ถ้าเชื่อมตรงไม่ได้จะต่อไม่ติด','muted'); }
          else stLog('ขอ TURN ไม่สำเร็จ: '+((d&&d.error)||r.status),'err');
        }catch(e){ stLog('ขอ TURN ไม่สำเร็จ: '+(e.message||e),'err'); }
      })();
      return ST.turnP;
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
      // ทางหลัก: ให้เธรดของตัวเกมจับภาพจาก OffscreenCanvas แล้วส่งมาเป็น ImageBitmap
      // (Safari ไม่ยอมให้หน้าเว็บอ่าน canvas ของเกมโดยตรง)
      globalThis.__br2OnFrame=function(bmp,err){
        if(err){ stLog('จับภาพในเธรดเกมไม่ได้: '+err,'err'); return; }
        if(!bmp) return;
        try{ if(cv.width!==bmp.width||cv.height!==bmp.height){ cv.width=bmp.width; cv.height=bmp.height; } cx.drawImage(bmp,0,0); ST.frames++; ST.grabbed++; ST.grabAt=performance.now(); }catch(_){ }
        try{ bmp.close(); }catch(_){ }
      };
      globalThis.__br2OnInfo=function(m){ stLog('เธรดเกม: '+m,'muted'); };
      ST.grabbed=0;
      // วาดทุกเฟรม: ตอนแท็บถูกซ่อน (บนคอม) requestAnimationFrame หยุด → ใช้ setTimeout แทน
      var drawGen=0;
      function loop(gen){ if(gen!==drawGen) return; draw(); if(document.hidden) setTimeout(function(){ loop(gen); },16); else requestAnimationFrame(function(){ loop(gen); }); }
      ST.restartDraw=function(){ drawGen++; loop(drawGen); };
      function draw(){
        if(ST.useDirect||performance.now()-(ST.grabAt||0)<500) return;
        try{
          var s=stGameCanvas(); if(!s||!s.width) return;
          var w=Math.min(ST.capW,s.width), h=Math.round(w*s.height/s.width)||480;
          if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
          cx.drawImage(s,0,0,w,h); ST.frames++;
        }catch(_){ }
      }
      ST.restartDraw();
      var ms=cv.captureStream(60);
      ST.media=ms; stAddAudio();
      // ตรวจว่าวาดสำเนาได้จริง (ไม่ดำล้วน) — ถ้าไม่ได้ ลองส่ง canvas ของเกมตรงๆ
      function check(){
        ST.checks=(ST.checks||0)+1;
        try{
          if(ST.useDirect){ ST.capInfo='จับภาพตรง'; return; }
          if(performance.now()-(ST.grabAt||0)<1000){ var t='มีภาพ '+cv.width+'×'+cv.height+' (เธรดเกม)'; if(t!==ST.capInfo){ ST.capInfo=t; stLog('ภาพที่จับได้: '+t,'ok'); } return; }
          var px=cx.getImageData(0,0,cv.width,cv.height).data, lit=0;
          for(var i=0;i<px.length;i+=4*97){ if(px[i]+px[i+1]+px[i+2]>30) lit++; }
          var none=(ST.frames===0); // วาดไม่ได้เลยสักเฟรม (หน้าจอเกมสีดำเป็นเรื่องปกติ ไม่นับ)
          if(none&&!ST.grabTried){ ST.grabTried=true; stGrab(true); } // สำรอง: ให้เธรดของเกมจับภาพเอง
          if(none&&ST.grabTried&&ST.grabbed===0&&ST.checks>2){
            var s=stGameCanvas();
            if(s&&s.captureStream){
              var direct=s.captureStream(60), vt=direct.getVideoTracks()[0];
              if(vt){ ST.useDirect=true; ms.getVideoTracks().forEach(function(t){ ms.removeTrack(t); t.stop(); }); ms.addTrack(vt);
                if(ST.pc){ ST.pc.getSenders().forEach(function(snd){ if(snd.track&&snd.track.kind==='video') snd.replaceTrack(vt); }); }
                stLog('วาดภาพสำเนาไม่ได้ → ส่งภาพจาก canvas ของเกมโดยตรง','muted'); }
            }
          }
          var txt=lit?'มีภาพ '+cv.width+'×'+cv.height:'ภาพดำ';
          if(txt!==ST.capInfo){ ST.capInfo=txt; stLog('ภาพที่จับได้: '+txt+' (วาดแล้ว '+ST.frames+' เฟรม)',lit?'ok':'err'); }
        }catch(e){ stLog('ตรวจภาพไม่ได้: '+(e.message||e),'err'); }
      }
      setTimeout(check,3000); setInterval(check,5000);
      return ms;
    }
    // canvas ของตัวเกม (Emscripten เปลี่ยน id จาก "screen" เป็น "canvas" ตอนเปิดเกม)
    function stGameCanvas(){
      try{ var c=ng&&ng.getCanvas&&ng.getCanvas(); if(c) return c; }catch(_){ }
      return document.getElementById('screen')||document.querySelector('#stage canvas')||document.querySelector('canvas');
    }
    function stGrab(on){
      var n=0;
      globalThis.__br2Grab=!!on; globalThis.__br2GrabW=ST.capW; // ถ้าลูปของเกมรันบนเธรดหลัก
      globalThis.__br2Deliver=function(d){ if(d.info){ if(globalThis.__br2OnInfo) globalThis.__br2OnInfo(d.info); return; } if(globalThis.__br2OnFrame) globalThis.__br2OnFrame(d.bmp,d.err); };
      try{ var M=ng&&ng.getEmscriptenModule(), PT=M&&M.__br2PThread;
        if(PT){ [].concat(PT.runningWorkers||[],PT.unusedWorkers||[]).forEach(function(w){ try{ w.postMessage({cmd:'br2grab',on:!!on,w:ST.capW}); n++; }catch(_){ } }); } }catch(_){ }
      stLog((on?'เปิด':'ปิด')+'การจับภาพในเธรดเกม (threads '+n+')','muted');
    }
    async function stHostOffer(){
      if(!ng){ stLog('ยังไม่ได้เปิดเกม — รอเกมเปิดก่อน','muted'); return; }
      await stLoadTurn();
      var ms=stHostMedia(), pc=stNewPc();
      ms.getTracks().forEach(function(t){ var snd=pc.addTrack(t,ms);
        if(t.kind==='video'){ try{ t.contentHint='motion'; }catch(_){ }
          try{ var p=snd.getParameters(); p.degradationPreference='maintain-framerate'; if(!p.encodings||!p.encodings.length) p.encodings=[{}]; p.encodings[0].maxBitrate=1500000; p.encodings[0].maxFramerate=60; snd.setParameters(p).catch(function(){}); }catch(_){ } } });
      var dc=pc.createDataChannel('in',{ordered:false,maxRetransmits:0}); ST.dc=dc;
      dc.onmessage=function(e){ try{ var d=JSON.parse(e.data); if(ST.peerAway) stPeerAway(false,2); if(d&&d.t==='sm') stOnMacro(d); else stOnInput(d); }catch(_){ } };
      var offer=await pc.createOffer(); await pc.setLocalDescription(offer);
      await stWaitIce(pc,2500);
      stSendSig('offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
      stLog('ส่งคำขอเชื่อมต่อให้ P2 แล้ว','muted');
    }
    function stOnInput(d){
      if(typeof d.s!=='number') return;
      if(d.s<=ST.remoteSeq&&ST.remoteSeq-d.s<1000) return; // ข้อความเก่า/ซ้ำ (ถ้า P2 โหลดหน้าใหม่ ลำดับจะเริ่มใหม่ → รับ)
      ST.remoteSeq=d.s; ST.inCount++; var bits=d.b|0, old=ST.remoteBits; if(bits===old) return;
      ST.remoteBits=bits;
      if((ST.inLogged=(ST.inLogged||0)+1)<=6){ var names=[]; for(var k=0;k<LS_BTN.length;k++) if(bits&(1<<k)) names.push(LS_BTN[k]); stLog('ปุ่มจาก P2: '+(names.join('+')||'(ปล่อย)')+(ng?'':' — แต่ยังไม่ได้เปิดเกม'),'ok'); }
      for(var i=0;i<LS_BTN.length;i++){ var m=1<<i; if((old^bits)&m){
        try{ if(bits&m) ng.pressDown({button:LS_BTN[i],player:2}); else ng.pressUp({button:LS_BTN[i],player:2}); }catch(e){ if(!ST.pressErr){ ST.pressErr=1; stLog('กดปุ่ม P2 ในเกมไม่ได้: '+(e.message||e),'err'); } } } }
    }

    // ----- มาโคร M1 ของ P2: ส่งคำสั่งทั้งชุดให้ P1 เป็นคนกด (จังหวะไม่เพี้ยนตามปิง) -----
    function stOnMacro(d){
      if(!ng||!d||(!Array.isArray(d.q)&&!d.stop)) return;
      if(d.id===ST.lastMacroId) return; ST.lastMacroId=d.id; // มาทั้งช่องตรงและผ่านเซิร์ฟเวอร์ → ใช้ครั้งเดียว
      if(d.stop){ if(typeof window.__br2MacroStop==='function') window.__br2MacroStop('p2'); return; } // P2 กดซ้ำ = หยุดมาโคร
      var steps=[];
      for(var i=0;i<d.q.length&&i<60;i++){ var q=d.q[i]; if(!Array.isArray(q)) return;
        var b=String(q[0]||'').split('+').filter(function(n){ return n&&LS_BTN.indexOf(n)>=0; });
        steps.push({b:b,h:Math.max(0,Math.min(300,q[1]|0)),w:Math.max(0,Math.min(500,q[2]|0))}); }
      if(typeof window.__br2MacroRun!=='function') return;
      window.__br2MacroRun(steps,function(n,on){ if(on) ng.pressDown({button:n,player:2}); else ng.pressUp({button:n,player:2}); },'p2');
      if((ST.macroLogged=(ST.macroLogged||0)+1)<=3) stLog('P2 ใช้มาโคร M1','muted');
    }
    ST.onMacro=stOnMacro; // ใช้ทดสอบ
    function stMacroSend(msg){ var js=JSON.stringify(msg); if(js.length>2000){ stLog('มาโครยาวเกินไป ส่งไม่ได้','err'); return false; }
      try{ if(ST.dc&&ST.dc.readyState==='open') ST.dc.send(js); }catch(_){ } lsSendRaw(msg); return true; }
    function stMacroLight(n){ ['btn-m1','btn-m2'].forEach(function(id){ var b=document.getElementById(id); if(b) b.classList.toggle('on',id==='btn-m'+n); }); }
    window.__br2MacroRemote=function(steps,n){
      if(stRole()!==2) return;
      var msg={t:'sm',id:(Date.now()%1000000000)+'-'+(++ST.seq),q:steps.map(function(s){ return [s.b.join('+'),s.h,s.w]; })};
      if(!stMacroSend(msg)) return;
      // P2 ไม่รู้ว่าเครื่อง P1 กดเสร็จเมื่อไร → ประมาณจากความยาวมาโคร (1 เฟรม = 20ms) + เผื่อปิง
      var fr=0; steps.forEach(function(s){ fr+=s.h+s.w; });
      var ms=fr*20+300; ST.remoteMacro={n:n||1,until:performance.now()+ms}; stMacroLight(n||1);
      clearTimeout(ST.remoteMacroT); ST.remoteMacroT=setTimeout(function(){ ST.remoteMacro=null; stMacroLight(0); },ms);
    };
    window.__br2MacroRemoteBusy=function(){ var m=ST.remoteMacro; return m&&performance.now()<m.until?m.n:0; };
    window.__br2MacroRemoteStop=function(){
      clearTimeout(ST.remoteMacroT); ST.remoteMacro=null; stMacroLight(0);
      stMacroSend({t:'sm',id:(Date.now()%1000000000)+'-'+(++ST.seq),stop:1});
    };

    // ----- P2: รับภาพ -----
    function stViewerUi(){
      if(ST.viewerUi) return; ST.viewerUi=true;
      try{ var ld=document.getElementById('loader'); if(ld) ld.classList.add('hidden'); }catch(_){ }
      try{ document.body.classList.add('running'); }catch(_){ }
      try{ if(typeof buildPad==='function') buildPad(); }catch(_){ }
      try{ if(typeof fit==='function'){ fit(); setTimeout(fit,200); } }catch(_){ }
      var v=document.createElement('video'); v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); v.autoplay=true; v.muted=true;
      v.style.cssText='position:fixed;z-index:2;background:#000;object-fit:contain;pointer-events:none';
      // ใส่วิดีโอไว้ในชั้นเดียวกับจอเกม (#stage) ใต้ปุ่มควบคุม (#pad) — ถ้าใส่ไว้ที่ body วิดีโอจะทับปุ่มทั้งหมด
      var stage=document.getElementById('stage'), padEl=document.getElementById('pad');
      if(stage){ v.style.zIndex='1'; if(padEl&&padEl.parentElement===stage) stage.insertBefore(v,padEl); else stage.appendChild(v); }
      else document.body.appendChild(v);
      ST.video=v;
      var coarseUi=(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches)||('ontouchstart' in window);
      try{ var pd=document.getElementById('pad'); if(pd&&coarseUi&&!window.__br2PadHidden) pd.classList.add('show'); }catch(_){ } // บนคอมไม่ต้องมีปุ่มบนจอ (ใช้คีย์บอร์ด/จอย)
      function place(){
        var s=document.getElementById('screen'), r=s?s.getBoundingClientRect():null, vw=window.innerWidth, vh=window.innerHeight;
        if(!r||r.width<80||r.height<60){ // ยังไม่ได้เปิดเกมในเครื่องนี้ canvas อาจมีขนาด 0 → วางวิดีโอเองเต็มความกว้าง
          var bar=document.getElementById('bar'), top=bar?Math.min(bar.getBoundingClientRect().bottom+8,vh*0.25):vh*0.15;
          var w=vw, h=Math.round(w*3/4); if(top+h>vh){ h=vh-top; w=Math.round(h*4/3); }
          r={left:(vw-w)/2,top:top,width:w,height:h};
        }
        // อย่าให้วิดีโอทับแถบเมนูด้านบน
        var bar2=document.getElementById('bar'), minTop=bar2?bar2.getBoundingClientRect().bottom+6:0;
        if(window.__br2Fill&&vw>vh){ // ยืดเต็มจอ: เต็มความกว้าง เว้นแค่แถบเมนูด้านบน
          var t0=Math.max(0,Math.min(r.top,vh*0.25)); if(r.top<minTop) t0=Math.min(minTop,vh*0.25);
          v.style.objectFit='fill'; v.style.left='0px'; v.style.top=t0+'px'; v.style.width=vw+'px'; v.style.height=(vh-t0)+'px'; return; }
        v.style.objectFit='contain';
        if(r.top<minTop){ var hh=Math.min(r.height,vh-minTop-6), ww=Math.min(r.width,Math.round(hh*4/3)); hh=Math.round(ww*3/4); r={left:(vw-ww)/2,top:minTop,width:ww,height:hh}; }
        v.style.left=r.left+'px'; v.style.top=r.top+'px'; v.style.width=r.width+'px'; v.style.height=r.height+'px'; }
      place(); setInterval(place,300); window.addEventListener('resize',function(){ setTimeout(place,50); });
      var tap=document.createElement('button'); tap.type='button'; tap.textContent='🔊 แตะเพื่อเปิดเสียง';
      tap.style.cssText='position:fixed;z-index:99998;left:50%;top:40%;transform:translateX(-50%);padding:10px 16px;border-radius:12px;border:1px solid #64748b;background:#101722f0;color:#fff;font:15px -apple-system,sans-serif;display:none';
      tap.addEventListener('click',function(){ v.muted=false; v.play().catch(function(){}); tap.style.display='none'; });
      document.body.appendChild(tap); ST.tap=tap;
      setInterval(function(){ // นับเฟรมที่ได้รับ เพื่อแสดงสถานะ
        try{ if(v.getVideoPlaybackQuality){ var q=v.getVideoPlaybackQuality(); ST.fps=q.totalVideoFrames-(ST.lastTotal||0); ST.lastTotal=q.totalVideoFrames; } }catch(_){ }
        var info='วิดีโอ '+v.videoWidth+'×'+v.videoHeight+' · readyState '+v.readyState+' · ถอดรหัส '+(ST.decFps||0)+' fps · '+(ST.kbps||0)+' kbps';
        if(info!==ST.lastInfo&&(Date.now()-(ST.lastInfoAt||0)>5000)){ ST.lastInfo=info; ST.lastInfoAt=Date.now(); stLog(info); }
      },1000);
      setInterval(stSendInput,100); // ส่งซ้ำเผื่อหาย
      stViewerKeys();
      var coarse=(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches)||('ontouchstart' in window);
      if(!coarse) stLog('เล่นบนคอม: ลูกศร=ทิศทาง · Z=✕ S=○ X=□ A=△ · Q/W=L1/R1 · 1/2=L2/R2 · Enter=Start · Shift ขวา=Select · หรือเสียบจอย','ok');
    }
    // ----- P2 บนคอม: คีย์บอร์ดและจอย (ไม่มีปุ่มบนจอเพราะไม่ใช่จอสัมผัส) -----
    // ปุ่มคีย์บอร์ดเหมือน P1: ลูกศร = ทิศทาง, Z=✕ S=○ X=□ A=△, Q=L1 W=R1, 1=L2 2=R2, Enter=Start, Shift ขวา=Select
    var ST_KEYS={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyZ:'b',KeyS:'a',KeyX:'y',KeyA:'x',
      KeyQ:'l',KeyW:'r',Digit1:'l2',Digit2:'r2',Enter:'start',NumpadEnter:'start',ShiftRight:'select'};
    function stViewerKeys(){
      function on(e,down){
        if(!window.__br2Viewer) return;
        var t=e.target; if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
        var b=ST_KEYS[e.code]; if(!b) return;
        e.preventDefault(); if(e.repeat) return;
        br2Input(b,down);
      }
      window.addEventListener('keydown',function(e){ on(e,true); },true);
      window.addEventListener('keyup',function(e){ on(e,false); },true);
      window.addEventListener('blur',function(){ Object.keys(ST_KEYS).forEach(function(k){ var b=ST_KEYS[k]; if(lsHeld[b]&&ST.padHeld&&!ST.padHeld[b]) br2Input(b,false); }); });
      // จอย (Gamepad API, ปุ่มแบบมาตรฐาน): 0=✕ 1=○ 2=□ 3=△ 4=L1 5=R1 6=L2 7=R2 8=Select 9=Start 12-15=ทิศทาง, ก้านซ้าย=ทิศทาง
      var GP=[['b',0],['a',1],['y',2],['x',3],['l',4],['r',5],['l2',6],['r2',7],['select',8],['start',9],['up',12],['down',13],['left',14],['right',15]];
      var gpPrev={}, gpSeen=false;
      function poll(){
        requestAnimationFrame(poll);
        if(!window.__br2Viewer||!navigator.getGamepads) return;
        var pads=(window.__br2RawPads?window.__br2RawPads():navigator.getGamepads())||[], g=null; for(var i=0;i<pads.length;i++){ if(pads[i]&&pads[i].connected){ g=pads[i]; break; } }
        if(!g) return;
        if(!gpSeen){ gpSeen=true; stLog('เจอจอย: '+g.id,'ok'); }
        var now={};
        GP.forEach(function(m){ var bt=g.buttons[m[1]]; now[m[0]]=!!(bt&&(bt.pressed||bt.value>0.5)); });
        var ax=g.axes||[]; if(ax.length>=2){ if(ax[0]<-0.5) now.left=true; if(ax[0]>0.5) now.right=true; if(ax[1]<-0.5) now.up=true; if(ax[1]>0.5) now.down=true; }
        Object.keys(now).forEach(function(k){ if(!!gpPrev[k]!==now[k]){ gpPrev[k]=now[k]; br2Input(k,now[k]); } });
      }
      requestAnimationFrame(poll);
    }
    function stHelloSoon(ms){ clearTimeout(ST.helloTimer); ST.helloTimer=setTimeout(stHello,ms||0); }
    function stHello(){
      if(stRole()!==2) return;
      if(ST.pc&&(ST.pc.connectionState==='connected'||ST.pc.connectionState==='connecting'||(ST.pc.connectionState==='new'&&Date.now()-ST.connectStarted<8000))) { stHelloSoon(3000); return; }
      lsSendRaw({t:'sh',p:2,v:1}); stHelloSoon(4000);
    }
    async function stViewerAnswer(offer){
      await stLoadTurn();
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
      var changed=(b!==ST.lastBits);
      ST.lastBits=b; ST.lastSend=now; var msg={b:b,s:++ST.seq}; ST.outCount++;
      if(ST.dc&&ST.dc.readyState==='open'){ try{ ST.dc.send(JSON.stringify(msg)); ST.outPath='ตรง'; return; }catch(_){ } }
      if(lsSendRaw({t:'si',p:2,b:b,s:msg.s})) ST.outPath='เซิร์ฟเวอร์'; else ST.outPath='ส่งไม่ได้'; // สำรอง: ผ่าน Worker
      if(changed&&b&&(ST.outLogged=(ST.outLogged||0)+1)<=3) stLog('ส่งปุ่มไป P1 ผ่าน'+ST.outPath+' (ช่องตรง: '+(ST.dc?ST.dc.readyState:'ไม่มี')+')','muted');
    }

    // ----- ข้อความจากห้อง -----
    function stOnSignal(kind,desc){
      if(kind==='offer'&&stRole()===2){ stViewerAnswer(desc).catch(function(e){ stLog('ตอบรับไม่สำเร็จ: '+(e.message||e),'err'); stHelloSoon(2000); }); }
      else if(kind==='answer'&&stRole()===1&&ST.pc){ ST.pc.setRemoteDescription(desc).catch(function(e){ stLog('รับคำตอบไม่สำเร็จ: '+(e.message||e),'err'); }); }
    }
    function stOnMessage(d){
      if(d.t==='sd'){ stOnSigChunk(d); return true; }
      if(d.t==='sh'){ if(stRole()===1) stHostOffer().catch(function(e){ stLog('สร้างการเชื่อมต่อไม่สำเร็จ: '+(e.message||e),'err'); }); return true; }
      // อีกเครื่องยังส่งปุ่ม/สถานะมาอยู่ = ไม่ได้พับจอแล้ว → ปิดป้าย "พับจออยู่" (กันข้อความ "กลับมาแล้ว" หาย)
      if(ST.peerAway&&(d.t==='si'||d.t==='sf'||d.t==='sm')) stPeerAway(false, stRole()===1?2:1);
      if(d.t==='si'){ if(stRole()===1) stOnInput(d); return true; }
      if(d.t==='sm'){ if(stRole()===1) stOnMacro(d); return true; }
      if(d.t==='sa'){ stPeerAway(!!d.a, d.p); return true; }
      if(d.t==='sf'){ if(stRole()===2){ ST.peerFight=(d.f===1); ntPlace(); } return true; }
      if(d.t==='nm'){ ntSetName(d.p, d.n); return true; }
      if(d.t==='rdy'||d.t==='i'){ LS.error='⚠️ อีกเครื่องเลือก "โหมดล็อกเฟรม"\nทั้งสองเครื่องต้องเลือกโหมดเดียวกันในหน้าห้อง'; lsShow(); return true; }
      return false;
    }
    function stShow(){
      var r=stRole(); if(!r){ br2Status('ห้อง '+br2Online.room+' · กำลังเชื่อมต่อ…',false); return; }
      if(LS.error){ br2Status('ห้อง '+br2Online.room+' · P'+r+'\n'+LS.error,false); return; }
      var ping=' · ping '+Math.round(ST.rtt||LS.rtt)+' ms', route=ST.route?(' · '+ST.route):'';
      if(r===1){
        if(!ng){ br2Status('📺 โหมดส่งภาพ · คุณคือ P1 (รันเกม)\nกด "เล่นต่อ" หรือเลือกไฟล์เกม',false); return; }
        if(ST.conn==='connected') br2Status('📺 P1 ส่งภาพอยู่'+ping+route+'\nส่ง '+(ST.encFps||0)+' fps · '+(ST.kbps||0)+' kbps · ปุ่ม P2 '+ST.inCount+(ST.capInfo?' · '+ST.capInfo:''),true);
        else br2Status('📺 P1 · รอ P2 เชื่อมต่อ…'+(ST.conn?' ('+ST.conn+')':''),false);
      } else {
        if(ST.conn==='connected'){ var v=ST.video; br2Status('📺 P2 รับภาพ'+ping+route+'\nภาพ '+(v?v.videoWidth+'×'+v.videoHeight:'-')+' · '+(ST.decFps||0)+' fps · '+(ST.kbps||0)+' kbps\nส่งปุ่ม '+ST.outCount+(ST.outPath?' ('+ST.outPath+')':''),true); }
        else if(ST.conn==='failed') br2Status('📺 P2 · เชื่อมต่อไม่ได้'+(ST.turnOk?' (แม้ผ่าน TURN)':'\nเน็ตไม่ยอมให้เชื่อมตรง และยังไม่ได้ตั้งค่า TURN')+'\nกำลังลองใหม่…',false);
        else br2Status('📺 โหมดส่งภาพ · คุณคือ P2\nกำลังเชื่อมต่อกับ P1…'+(ST.conn?' ('+ST.conn+')':''),false);
      }
    }
    async function stStats(){
      var pc=ST.pc; if(!pc||pc.connectionState!=='connected') return;
      try{
        var rep=await pc.getStats(), pair=null, cands={};
        rep.forEach(function(s){ if(s.type==='candidate-pair'&&s.state==='succeeded'&&(s.nominated||s.selected)) pair=s; if(s.type==='local-candidate'||s.type==='remote-candidate') cands[s.id]=s; });
        rep.forEach(function(s){
          if(s.type==='inbound-rtp'&&s.kind==='video'){ ST.decFps=s.framesDecoded-(ST.lastDec||0); ST.lastDec=s.framesDecoded; ST.kbps=Math.round(((s.bytesReceived||0)-(ST.lastBytes||0))*8/1000); ST.lastBytes=s.bytesReceived||0; }
          if(s.type==='outbound-rtp'&&s.kind==='video'){ ST.encFps=s.framesEncoded-(ST.lastEnc||0); ST.lastEnc=s.framesEncoded; ST.kbps=Math.round(((s.bytesSent||0)-(ST.lastBytes||0))*8/1000); ST.lastBytes=s.bytesSent||0; }
        });
        if(pair){ if(pair.currentRoundTripTime) ST.rtt=pair.currentRoundTripTime*1000;
          var lc=cands[pair.localCandidateId], rc=cands[pair.remoteCandidateId];
          var relay=(lc&&lc.candidateType==='relay')||(rc&&rc.candidateType==='relay');
          ST.route=relay?'ผ่านเซิร์ฟเวอร์':'เชื่อมตรง'; }
      }catch(_){ }
    }
    window.__br2Stream={ST:ST,hostMedia:function(){ return stHostMedia(); },ng:function(){ return ng; }}; // สำหรับตรวจสอบ/ทดสอบ
    // ออกจากหน้าเกม / สลับแอป: หยุดเสียงและวิดีโอ (iOS เล่นเสียงของ <video> ต่อในพื้นหลังได้)
    // คอม (ไม่ใช่มือถือ/แท็บเล็ต): พับจอหรือสลับหน้าต่างแล้วเกมยังเดินต่อ ไม่หลุดจากเพื่อน
    function stIsDesktop(){
      try{ if(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return false;
        if(navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent)) return false; // iPad ที่แสดงตัวเป็น Mac
        return !matchMedia('(pointer:coarse)').matches; }catch(_){ return true; }
    }
    if(stIsDesktop()) globalThis.__br2NoHide=true; // คอม: อย่าบอก RetroArch ว่าหน้าต่างถูกซ่อน (มันจะหยุดเกม)
    function stKeepRunningHidden(hidden){
      try{ if(stRole()===1&&typeof globalThis.__br2MainLoopTiming==='function'){
        if(hidden) globalThis.__br2MainLoopTiming(0,16); else globalThis.__br2MainLoopTiming(1,1);
        ST.bgTiming=hidden; } }catch(_){ }
      try{ if(ST.restartDraw) ST.restartDraw(); }catch(_){ }
      if(hidden&&!ST.bgLogged){ ST.bgLogged=true; stLog('พับจอ/สลับหน้าต่าง → เกมเดินต่อ (คอม)','muted'); }
    }
    // แจ้งอีกเครื่องว่าเราพับจอ/กลับมา + ป้ายบนจอ "รออีกฝ่ายกลับมา"
    function stSendAway(a){ try{ lsSendRaw({t:'sa',p:stRole(),a:a?1:0}); }catch(_){ } }
    function stPeerAway(a,p){
      ST.peerAway=a;
      var el=document.getElementById('br2-away');
      if(!el){ el=document.createElement('div'); el.id='br2-away';
        el.style.cssText='position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:50;padding:12px 18px;border-radius:12px;background:rgba(0,0,0,.78);color:#ffd27a;font:600 15px system-ui,sans-serif;text-align:center;pointer-events:none;border:1px solid #c9a24b';
        document.body.appendChild(el); }
      el.textContent=(p===1?'P1':'P2')+' พับจออยู่ · รอกลับมาเล่นต่อ…';
      el.style.display=a?'':'none';
      stLog(a?((p===1?'P1':'P2')+' พับจอ'):((p===1?'P1':'P2')+' กลับมาแล้ว'),'muted');
    }
    ST.testAway=stPeerAway; // ใช้ทดสอบ
    function stOnHidden(){
      if(stIsDesktop()){ stKeepRunningHidden(true); return; }
      stSendAway(true);
      try{ if(ST.video){ ST.video.muted=true; ST.video.pause(); } }catch(_){ }
      try{ if(ST.audioDest&&ST.audioDest.context&&ST.audioDest.context.state==='running') ST.audioDest.context.suspend(); }catch(_){ }
      // P1: หยุดเกมชั่วคราว (การส่งภาพทำให้ iOS ไม่พักหน้าเว็บ เกมกับเสียงจึงเล่นต่อในพื้นหลัง)
      try{ if(stRole()===1&&ng&&!ST.hidePaused){ ng.pause(); ST.hidePaused=true; stLog('สลับแอป → หยุดเกมชั่วคราว','muted'); } }catch(_){ }
    }
    function stOnVisible(){
      if(ST.bgTiming!==undefined&&stIsDesktop()){ stKeepRunningHidden(false); }
      try{ if(ST.video){ ST.video.play().catch(function(){}); if(ST.tap&&ST.video.srcObject&&ST.video.srcObject.getAudioTracks().length) ST.tap.style.display=''; } }catch(_){ }
      try{ if(ST.audioDest&&ST.audioDest.context&&ST.audioDest.context.state==='suspended') ST.audioDest.context.resume(); }catch(_){ }
      try{ if(ST.hidePaused&&ng){ ng.resume(); ST.hidePaused=false; stLog('กลับมาที่เกม → เล่นต่อ','muted'); } }catch(_){ }
      if(!stIsDesktop()) stResumeLinks();
    }
    // มือถือกลับมาจากพับจอ: iOS อาจตัดการเชื่อมต่อไปแล้ว → ต่อห้องและต่อภาพใหม่ทันที
    function stResumeLinks(){
      try{ if(!LS.ws||LS.ws.readyState>1){ stLog('ต่อห้องใหม่หลังพับจอ','muted'); lsConnect(); } }catch(_){ }
      var tries=0;
      (function wait(){ // รอห้องเชื่อมต่อแล้วค่อยแจ้ง/ขอภาพใหม่
        if(LS.ws&&LS.ws.readyState===1){ stSendAway(false); setTimeout(function(){ if(!document.hidden) stSendAway(false); },1000); setTimeout(function(){ if(!document.hidden) stSendAway(false); },3000); if(stRole()===2){ var cs=ST.pc&&ST.pc.connectionState; if(cs!=='connected'){ stClosePc(); } stHelloSoon(0); } return; }
        if(++tries<40) setTimeout(wait,250);
      })();
    }
    document.addEventListener('visibilitychange',function(){ if(!ST.on) return; if(document.hidden) stOnHidden(); else stOnVisible(); });
    window.addEventListener('pagehide',function(){ if(!ST.on) return; stOnHidden(); stClosePc(); });
    // ===== ป้ายชื่อผู้เล่นบนจอเกม (วางซ้อนบนหน้าเว็บ ไม่ได้แก้ตัวเกม) =====
    // ตำแหน่งเทียบกับภาพเกม: แถวเดียวกับชื่อตัวละครในเกม (สูงราว 19% ของภาพ) ถัดเข้ามาทางกลางจอ
    var NT={on:true,el1:null,el2:null,box:null};
    try{ NT.on=localStorage.getItem('br2_name_tags')!=='0'; }catch(_){ }
    function ntNames(){ var q; try{ q=new URLSearchParams(location.search); }catch(_){ q=null; }
      var n1=(q&&q.get('n1')||'').trim().slice(0,20), n2=(q&&q.get('n2')||'').trim().slice(0,20);
      var me=(q&&q.get('me')||'').trim().slice(0,20);
      if(me){ if(stRole()===1) n1=me; else if(stRole()===2) n2=me; }
      NT.me=me; return [n1||'Player 1', n2||'Player 2']; }
    function ntSetName(p,n){ n=String(n||'').trim().slice(0,20); if(!n||(p!==1&&p!==2)) return;
      if(!NT.box) ntMake(); var el=p===1?NT.el1:NT.el2; if(el&&el.textContent!==n){ el.textContent=n; } }
    function ntSendName(){ if(!NT.me) return; try{ lsSendRaw({t:'nm',p:stRole(),n:NT.me}); }catch(_){ } }
    function ntGameRect(){
      var stage=document.getElementById('stage'); if(!stage) return null;
      var el=window.__br2Viewer?ST.video:document.querySelector('#stage canvas'); if(!el) return null;
      var r=el.getBoundingClientRect(); if(!r.width||!r.height) return null;
      if(window.__br2Viewer&&el.videoWidth&&el.style.objectFit!=='fill'){ // วิดีโอแบบ contain: หาพื้นที่ภาพจริง
        var va=el.videoWidth/el.videoHeight, ra=r.width/r.height, w=r.width, h=r.height;
        if(ra>va){ w=h*va; } else { h=w/va; }
        r={left:r.left+(r.width-w)/2, top:r.top+(r.height-h)/2, width:w, height:h};
      }
      var sr=stage.getBoundingClientRect();
      return {left:r.left-sr.left, top:r.top-sr.top, width:r.width, height:r.height};
    }
    function ntMake(){
      if(NT.box) return; var stage=document.getElementById('stage'); if(!stage) return;
      var box=document.createElement('div'); box.id='br2-name-tags';
      box.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:2';
      var mk=function(c,b){ var d=document.createElement('div');
        d.style.cssText='position:absolute;font-weight:600;font-family:system-ui,sans-serif;padding:.1em .5em;border-radius:.35em;background:rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35;color:'+c+';border:1px solid '+b;
        box.appendChild(d); return d; };
      NT.el1=mk('#ffd27a','rgba(201,162,75,.85)'); NT.el2=mk('#9fd3ff','rgba(96,165,250,.85)');
      var n=ntNames(); NT.el1.textContent=n[0]; NT.el2.textContent=n[1];
      var pad=document.getElementById('pad'); if(pad&&pad.parentNode===stage) stage.insertBefore(box,pad); else stage.appendChild(box);
      NT.box=box;
    }
    function ntPlace(){
      if(!NT.box) ntMake(); if(!NT.box) return;
      var g=ntGameRect(); if(!NT.on||!g||!ntFighting()){ NT.box.style.display='none'; ntMenuLabel(); return; }
      NT.box.style.display='';
      var fs=Math.max(10,Math.round(g.height*0.034)), cy=g.top+g.height*0.192;
      [[NT.el1,0.17],[NT.el2,0.83]].forEach(function(x,i){ var el=x[0];
        el.style.fontSize=fs+'px'; el.style.maxWidth=Math.round(g.width*0.18)+'px';
        el.style.top=Math.round(cy-fs*0.7)+'px';
        if(i===0){ el.style.left=Math.round(g.left+g.width*x[1])+'px'; el.style.right=''; }
        else { el.style.left=''; var st=document.getElementById('stage'); var W=st?st.getBoundingClientRect().width:innerWidth; el.style.right=Math.round(W-(g.left+g.width*x[1]))+'px'; }
      });
      ntMenuLabel();
    }
    function ntMenuLabel(){ var b=document.getElementById('btn-name-tags'); if(b) b.textContent=NT.on?'ป้ายชื่อ: เปิด':'ป้ายชื่อ: ปิด'; }
    function ntMenuButton(){
      if(document.getElementById('btn-name-tags')) return;
      var ref=document.getElementById('btn-aspect'); if(!ref||!ref.parentNode) return;
      var b=document.createElement('button'); b.type='button'; b.id='btn-name-tags'; b.title='แสดง/ซ่อนชื่อผู้เล่นบนจอเกม';
      b.addEventListener('click',function(e){ e.stopPropagation(); NT.on=!NT.on; try{ localStorage.setItem('br2_name_tags',NT.on?'1':'0'); }catch(_){ } ntPlace(); ntMenuLabel(); });
      ref.parentNode.insertBefore(b,ref.nextSibling); ntMenuLabel();
    }
    // แสดงเฉพาะตอนกำลังสู้: P1 อ่านจาก RAM ของเกม แล้วส่งสถานะให้ P2 · ถ้าอ่านไม่ได้ แสดงตลอด (แบบเดิม)
    // ยังไม่รู้สถานะ = ซ่อนไว้ก่อน (ไม่ขึ้นค้างตอนโหลดเกม)
    function ntFighting(){
      if(window.__br2Viewer){ return ST.peerFight===true; }
      var f=window.__br2Fight&&window.__br2Fight(); return !!(f&&f.ready&&f.state===true);
    }
    function ntFightTick(){
      if(window.__br2Viewer||typeof window.__br2FightPoll!=='function') return;
      window.__br2FightPoll().then(function(st){
        var v=st===true?1:0;
        if(v!==ST.sentFight||Date.now()-(ST.sentFightAt||0)>3000){ ST.sentFight=v; ST.sentFightAt=Date.now(); try{ lsSendRaw({t:'sf',f:v}); }catch(_){ } }
      });
    }
    function ntStart(){ ntMenuButton(); ntPlace(); ntSendName(); var ns=0, nt=setInterval(function(){ ntSendName(); if(++ns>=12) clearInterval(nt); },5000); setInterval(function(){ ntFightTick(); ntPlace(); },300); window.addEventListener('resize',function(){ setTimeout(ntPlace,50); }); }
    ST.ntPlace=ntPlace; // ใช้ทดสอบ

    function stStart(){
      stLog('เริ่มโหมดส่งภาพ (P'+(ST.hint||'?')+')','ok');
      if(window.__br2Viewer) setTimeout(stViewerUi,0); // หลังสคริปต์ทั้งหน้าทำงานครบ (ไม่งั้นตัวแปรของ D-pad ถูกรีเซ็ต)
      setInterval(function(){ stStats(); lsShow(); },1000);
      stLoadTurn(); stHelloSoon(800);
      setTimeout(ntStart,0);
    }
