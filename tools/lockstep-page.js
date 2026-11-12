    // ---------- BR2 ONLINE LOCKSTEP (play-online.html) ----------
    // ทั้งสองเครื่องรันเกมพร้อมกันแบบล็อกเฟรม: เฟรมถัดไปจะรันเมื่อรู้ปุ่มของทั้งสองฝั่งแล้วเท่านั้น
    // ปุ่มของเราถูกหน่วงไว้ LS.delay เฟรม เพื่อให้มีเวลาส่งถึงอีกเครื่องก่อนถึงเฟรมนั้น
    window.__br2Lockstep=true;
    var br2Online={socket:null,room:'',playerId:'',role:0,ready:false,worker:'https://br2-online-rooms.fukthefuk400.workers.dev',status:null,remoteHeld:{},startedAt:0,loadedStartedAt:0,stateLoadPromise:null};
    var LS={delay:4,fixedDelay:false,RING:256,ws:null,B:null,sab:null,local:{},remote:{},sent:-1,avail:-1,started:false,myReady:false,peerFp:null,fp:'',rtt:0,lastPong:0,lastStall:0,stallMs:0,error:'',reconnectTimer:null,pumpTimer:null};
    var LS_BTN=['up','down','left','right','a','b','x','y','l','r','l2','r2','start','select','l_x_minus','l_x_plus','l_y_minus','l_y_plus','r_x_minus','r_x_plus','r_y_minus','r_y_plus'];
    var lsHeld={}; window.__br2LS=LS;
    // ---------- ซิงก์ภาพใหม่ (resync) ----------
    // ถ้าภาพสองเครื่องเพี้ยนกัน (มักเกิดหลังปิงค้าง) ให้ทั้งสองเครื่องหยุดที่เฟรมเดียวกัน (K)
    // แล้ว P1 ส่งเซฟสถานะของตัวเองให้ P2 โหลดทับ จากนั้นเดินต่อพร้อมกัน → ภาพกลับมาตรงกัน
    // ข้อความส่งผ่าน Worker เดิม (จำกัด 2048 ตัวอักษร/ข้อความ) จึงแบ่งเซฟเป็นชิ้นเล็กๆ
    var RS_STALL_MS=300, RS_COOLDOWN_MS=5000, RS_CHUNK=1800;
    var RS={active:false,k:0,lastDone:0,parts:null,n:0,got:0,z:0,len:0,h:'',abort:false,peerDone:false,go:false,btn:null};
    function rsRequest(){
      if(!LS.started||RS.active) return;
      if(br2Online.role===1) rsBegin(LS.sent+1);
      else lsSendRaw({t:'rsq',p:br2Online.role});
    }
    function rsBegin(k){
      if(RS.active||!LS.started) return;
      RS.active=true; RS.k=k; RS.parts=null; RS.n=0; RS.got=0; RS.abort=false; RS.peerDone=false; RS.go=false;
      if(br2Online.role===1) lsSendRaw({t:'rs',p:1,k:k});
      lsShow();
      rsRun().catch(function(e){ try{ showLog(); log('ซิงก์ภาพ: '+(e&&e.message||e),'err'); }catch(_){ } rsFinish(); });
    }
    async function rsWaitFor(test,ms){ var t0=Date.now(); while(!test()){ if(Date.now()-t0>ms) return false; await wait(20); } return true; }
    function rsB64(u8){ var s='', CH=0x8000; for(var i=0;i<u8.length;i+=CH) s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH)); return btoa(s); }
    function rsUnB64(s){ var bin=atob(s), u8=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }
    async function rsGzip(u8,compress){
      if(typeof CompressionStream==='undefined'||typeof DecompressionStream==='undefined') return null;
      var stream=new Blob([u8]).stream().pipeThrough(compress?new CompressionStream('gzip'):new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async function rsSendState(bytes){
      var z=0, data=bytes;
      try{ var c=await rsGzip(bytes,true); if(c&&c.length<bytes.length){ data=c; z=1; } }catch(_){ }
      var b64=rsB64(data), n=Math.ceil(b64.length/RS_CHUNK);
      if(!lsSendRaw({t:'rsh',p:1,n:n,z:z,len:bytes.length,h:lsHash(bytes)})) throw new Error('ส่งข้อมูลไม่ได้ (หลุดการเชื่อมต่อ)');
      for(var i=0;i<n;i++){
        while(LS.ws&&LS.ws.bufferedAmount>262144) await wait(10);
        if(!lsSendRaw({t:'sc',p:1,i:i,d:b64.substr(i*RS_CHUNK,RS_CHUNK)})) throw new Error('ส่งเซฟไม่ครบ (หลุดการเชื่อมต่อ)');
        if(i%50===49){ br2Status('ห้อง '+br2Online.room+' · กำลังซิงก์ภาพ… '+Math.round((i+1)*100/n)+'%',false); await wait(0); }
      }
      log('ซิงก์ภาพ: ส่งเซฟ '+(data.length/1024).toFixed(0)+' KB ('+n+' ชิ้น)','ok');
    }
    async function rsReceiveState(){
      var ok=await rsWaitFor(function(){ return RS.abort||(RS.parts&&RS.got===RS.n); },60000);
      if(!ok||RS.abort) throw new Error(RS.abort?'P1 ส่งเซฟไม่สำเร็จ':'รอรับเซฟนานเกินไป');
      var data=rsUnB64(RS.parts.join('')); RS.parts=null;
      var bytes=RS.z?await rsGzip(data,false):data;
      if(!bytes||bytes.length!==RS.len||lsHash(bytes)!==RS.h) throw new Error('เซฟที่ได้รับไม่สมบูรณ์');
      await robustLoadState(bytes);
      await wait(1500);
      log('ซิงก์ภาพ: โหลดเซฟจาก P1 แล้ว','ok');
    }
    async function rsRun(){
      var M=null; try{ M=ng.getEmscriptenModule(); }catch(_){ }
      var role=br2Online.role, failed='';
      // 1) รอจนตัวเกมหยุดอยู่ที่เฟรม K พอดี (ทั้งสองเครื่องจะหยุดที่เฟรมเดียวกัน)
      if(!await rsWaitFor(function(){ return Atomics.load(LS.B,1)>=RS.k; },20000)) failed='รอเฟรมไม่ทัน';
      if(!failed&&Atomics.load(LS.B,1)!==RS.k) failed='เฟรมไม่ตรง ('+Atomics.load(LS.B,1)+' / '+RS.k+')';
      if(!failed){
        // 2) หยุดเกมชั่วคราว แล้วปล่อยให้ RetroArch ทำงาน (คำสั่งเซฟ/โหลดต้องใช้) โดยตัวเกมไม่เดิน
        lsCmd(M,'_cmd_pause'); await wait(200);
        Atomics.store(LS.B,0,0); await wait(300);
        try{
          if(role===1){ var st=await robustSaveState(); await rsSendState(new Uint8Array(await st.state.arrayBuffer())); }
          else await rsReceiveState();
        }catch(e){ failed=(e&&e.message)||String(e); if(role===1) lsSendRaw({t:'rsx',p:1}); }
        // 3) ล็อกเฟรมไว้ก่อน แล้วค่อยสั่งเล่นต่อ (ใช้ในเฟรมแรกที่ปล่อยพร้อมกัน เหมือนตอนเริ่มเกม)
        Atomics.store(LS.B,0,1); await wait(250);
        lsCmd(M,'_cmd_unpause');
      }
      else if(role===1) lsSendRaw({t:'rsx',p:1});
      if(failed){ try{ showLog(); log('ซิงก์ภาพไม่สำเร็จ: '+failed,'err'); }catch(_){ } }
      // 4) นัดเดินต่อพร้อมกัน
      if(role===1){ await rsWaitFor(function(){ return RS.peerDone; },45000); lsSendRaw({t:'rsgo',p:1}); }
      else { lsSendRaw({t:'rsd',p:2}); await rsWaitFor(function(){ return RS.go; },45000); }
      rsFinish();
    }
    function rsFinish(){
      RS.active=false; RS.parts=null; RS.lastDone=Date.now(); LS.waitSince=0;
      if(LS.B) Atomics.store(LS.B,0,2);
      lsPump(); lsShow();
    }
    function rsOnMessage(d){
      if(d.t==='rsq'){ if(br2Online.role===1&&Date.now()-RS.lastDone>3000) rsRequest(); return true; }
      if(d.t==='rs'){ if(br2Online.role===2&&typeof d.k==='number') rsBegin(d.k); return true; }
      if(d.t==='rsh'){ RS.n=d.n|0; RS.z=d.z|0; RS.len=d.len|0; RS.h=String(d.h||''); RS.parts=new Array(RS.n); RS.got=0; return true; }
      if(d.t==='sc'){ if(RS.parts&&d.i>=0&&d.i<RS.n&&RS.parts[d.i]===undefined){ RS.parts[d.i]=String(d.d||''); RS.got++;
          if(RS.got%50===0) br2Status('ห้อง '+br2Online.room+' · กำลังซิงก์ภาพ… '+Math.round(RS.got*100/RS.n)+'%',false); } return true; }
      if(d.t==='rsx'){ RS.abort=true; return true; }
      if(d.t==='rsd'){ RS.peerDone=true; return true; }
      if(d.t==='rsgo'){ RS.go=true; return true; }
      return false;
    }
    function rsMakeButton(){
      if(RS.btn) return;
      var b=document.createElement('button'); b.type='button'; b.textContent='🔄 ซิงก์ภาพ';
      b.style.cssText='position:fixed;z-index:99998;right:8px;top:calc(env(safe-area-inset-top,0px) + 72px);padding:6px 10px;border:1px solid #64748b;border-radius:9px;background:#101722e0;color:#f8fafc;font:12px -apple-system,BlinkMacSystemFont,sans-serif';
      b.addEventListener('click',function(e){ e.preventDefault(); if(!LS.started||RS.active) return; log('ซิงก์ภาพ: กดเอง','ok'); rsRequest(); });
      document.body.appendChild(b); RS.btn=b;
    }
    function br2Status(message,ok){
      var el=br2Online.status;
      if(!el){el=document.createElement('div');el.id='br2-online-status';el.style.cssText='position:fixed;z-index:99998;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);max-width:min(62vw,300px);padding:7px 10px;border:1px solid #64748b;border-radius:9px;background:#101722eF;color:#f8fafc;font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;text-align:right;white-space:pre-line';document.body.appendChild(el);br2Online.status=el;}
      el.textContent=message;el.style.borderColor=ok?'#22c55e':'#64748b';el.style.color=ok?'#86efac':'#f8fafc';
    }
    function br2Send(data){var ws=LS.ws;if(ws&&ws.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(data));return true;}catch(_){}}return false;}
    // ปุ่มจากจอสัมผัส: เก็บสถานะไว้เท่านั้น จะถูกส่งเข้าเกมผ่านระบบล็อกเฟรม
    function br2Input(button,pressed){ if(pressed) lsHeld[button]=true; else delete lsHeld[button]; }
    function br2ReleaseRemote(){}
    window.__br2Press=function(b,on){ br2Input(b,on); };
    function lsBits(){var b=0;for(var i=0;i<LS_BTN.length;i++){if(lsHeld[LS_BTN[i]])b|=(1<<i);}return b;}
    function lsSendRaw(obj){
      // ข้อความ lockstep ต้องขึ้นต้นด้วย {"t":" เพื่อให้ Worker ส่งต่อแบบเร็ว
      var ws=LS.ws; if(!ws||ws.readyState!==WebSocket.OPEN) return false;
      try{ ws.send(JSON.stringify(obj)); return true; }catch(_){ return false; }
    }
    function lsFingerprint(){
      var bios='HLE'; try{ if(biosBlob) bios=(biosName||'bios')+':'+biosBlob.size; }catch(_){ }
      var size=0; try{ size=curFile?curFile.size:0; }catch(_){ }
      return String(romId)+'|'+size+'|'+bios;
    }
    function lsShow(){
      if(!br2Online.role){ br2Status('ห้อง '+br2Online.room+' · กำลังเชื่อมต่อ…',false); return; }
      var who='คุณคือ P'+br2Online.role;
      if(LS.error){ br2Status('ห้อง '+br2Online.room+' · '+who+'\n'+LS.error,false); return; }
      if(!ng){ br2Status('ห้อง '+br2Online.room+' · '+who+'\nกด "เล่นต่อ" หรือเลือกไฟล์เกม Bloody Roar 2',false); return; }
      if(!LS.started){ br2Status('ห้อง '+br2Online.room+' · '+who+'\n'+(LS.peerFp?'กำลังเริ่ม…':'รออีกเครื่องโหลดเกม…'),false); return; }
      if(RS.active){ br2Status(who+' · 🔄 กำลังซิงก์ภาพให้ตรงกัน…\n(รอสักครู่ เกมจะเดินต่อเอง)',false); return; }
      var F=LS.B?Atomics.load(LS.B,1):0;
      var waiting=LS.avail<F;
      br2Status(who+' · เฟรม '+F+'\nping '+Math.round(LS.rtt)+' ms · หน่วง '+LS.delay+' เฟรม'+(waiting?'\n⏳ รอข้อมูลจากอีกเครื่อง…':''),!waiting);
    }
    function lsPump(){
      if(!LS.started||!LS.B) return;
      var B=LS.B, F=Atomics.load(B,1);
      // จับเวลาที่เกมต้องหยุดรออีกเครื่อง: ถ้าค้างนาน (ปิงกระตุก/หลุด) ให้ซิงก์ภาพใหม่อัตโนมัติ
      if(!RS.active){
        if(LS.avail<F){ if(!LS.waitSince) LS.waitSince=performance.now(); }
        else if(LS.waitSince){ var stalled=performance.now()-LS.waitSince; LS.waitSince=0;
          if(stalled>=150){ try{ log('Lockstep: เกมหยุดรออีกเครื่อง '+Math.round(stalled)+' ms ที่เฟรม '+F,'muted'); }catch(_){ } }
          if(stalled>=RS_STALL_MS&&Date.now()-RS.lastDone>RS_COOLDOWN_MS){ try{ log('Lockstep: ค้างรออีกเครื่อง '+Math.round(stalled)+' ms → ซิงก์ภาพใหม่','err'); }catch(_){ } rsRequest(); } }
      }
      var cap=RS.active?RS.k-1:Infinity;
      // สุ่มอ่านปุ่มของเราล่วงหน้า delay เฟรม แล้วส่งให้อีกเครื่อง
      while(LS.sent < F+LS.delay && LS.sent < cap && LS.sent-F < LS.RING-16){
        LS.sent++; var b=lsBits(); LS.local[LS.sent]=b;
        lsSendRaw({t:'i',p:br2Online.role,f:LS.sent,b:b});
      }
      // เฟรมที่รู้ปุ่มครบทั้งสองฝั่ง → เขียนลงหน่วยความจำร่วมให้ตัวเกมใช้
      while(true){
        var n=LS.avail+1, mine=LS.local[n], theirs=LS.remote[n];
        if(n>cap||mine===undefined||theirs===undefined) break;
        var base=16+(n%LS.RING)*2;
        B[base]=br2Online.role===1?mine:theirs;
        B[base+1]=br2Online.role===1?theirs:mine;
        LS.avail=n; Atomics.store(B,2,n);
        delete LS.local[n-LS.RING]; delete LS.remote[n-LS.RING];
      }
    }
    function lsTryStart(){
      if(LS.started||!LS.myReady||LS.peerFp===null||!LS.B) return;
      if(LS.peerFp!==LS.fp){
        LS.error='⚠️ ไฟล์เกม/BIOS ของสองเครื่องไม่ตรงกัน\nต้องใช้ไฟล์เดียวกันทุกไบต์จึงจะเล่นด้วยกันได้';
        try{ showLog(); log('Lockstep: fingerprint ไม่ตรงกัน — เรา '+LS.fp+' / อีกเครื่อง '+LS.peerFp,'err'); }catch(_){ }
        lsShow(); return;
      }
      LS.error='';
      // ไม่เติมเฟรมล่วงหน้า: ทั้งสองเครื่องส่งปุ่มจริงตั้งแต่เฟรม 0 (ค่าหน่วงของสองเครื่องไม่จำเป็นต้องเท่ากัน)
      LS.sent=-1; LS.avail=-1;
      Atomics.store(LS.B,1,0); Atomics.store(LS.B,2,-1); Atomics.store(LS.B,0,2);
      LS.started=true;
      try{ log('Lockstep เริ่มแล้ว · P'+br2Online.role+' · หน่วง '+LS.delay+' เฟรม','ok'); }catch(_){ }
      lsPump(); lsShow();
    }
    function lsSendReady(ask){ if(LS.myReady) lsSendRaw({t:'rdy',p:br2Online.role,fp:LS.fp,ask:!!ask}); }
    // เรียกหลัง Nostalgist.launch สำเร็จ: ผูกหน่วยความจำร่วมเข้ากับเธรดของตัวเกม
    window.__br2AfterLaunch=function(){
      try{
        if(!window.crossOriginIsolated||typeof SharedArrayBuffer==='undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับ SharedArrayBuffer (ต้องเปิดผ่านเว็บไซต์ ไม่ใช่ไฟล์ในเครื่อง)');
        var M=ng.getEmscriptenModule(), emu=ng.getEmulator();
        var codes=[LS_BTN.map(function(b){return emu.getKeyboardCode(b,1)||'';}),LS_BTN.map(function(b){return emu.getKeyboardCode(b,2)||'';})];
        LS.sab=new SharedArrayBuffer(4*(16+LS.RING*2)); LS.B=new Int32Array(LS.sab);
        Atomics.store(LS.B,0,1);
        globalThis.__br2codes=codes; globalThis.__br2i=LS.B;
        var PT=M&&M.__br2PThread, n=0;
        if(PT){ [].concat(PT.runningWorkers||[],PT.unusedWorkers||[]).forEach(function(w){ try{ w.postMessage({cmd:'br2lock',sab:LS.sab,codes:codes}); n++; }catch(_){ } }); }
        log('Lockstep: ผูกกับตัวเกมแล้ว (threads '+n+')','ok');
        // ระหว่างเตรียมจุดเซฟ ให้เกมเดินได้ตามปกติ (สถานะก่อนโหลดเซฟไม่มีผลกับเกม)
        Atomics.store(LS.B,0,0);
        lsPrepareSave(M);
      }catch(e){ LS.error='⚠️ '+(e&&e.message||e); try{ showLog(); log('Lockstep: '+LS.error,'err'); }catch(_){ } lsShow(); }
    };
    function lsHash(u8){ var h=0x811c9dc5; for(var i=0;i<u8.length;i+=7){ h^=u8[i]; h=Math.imul(h,0x01000193); } return (h>>>0).toString(16)+':'+u8.length; }
    function lsCmd(M,name){ try{ if(M&&typeof M[name]==='function'){ M[name](); return true; } }catch(_){ } return false; }
    // โหลดจุดเซฟกลาง (หน้าเลือกตัวละคร 2P) ให้ตรงกันทุกเฟรม:
    // 1) หยุดเกม  2) โหลดเซฟ (เครื่องไหนเสร็จก่อนก็ยังหยุดรอ)  3) ล็อกเฟรม  4) สั่งเล่นต่อ — คำสั่งเล่นต่อจะถูกใช้ในเฟรมแรกที่ปล่อยพร้อมกันทั้งสองเครื่อง
    async function lsPrepareSave(M){
      var saveTag='boot';
      try{
        br2Status('ห้อง '+br2Online.room+' · กำลังโหลดจุดเซฟ…',false);
        if(!lsCmd(M,'_cmd_pause')) throw new Error('หยุดเกมชั่วคราวไม่ได้');
        await wait(300);
        var endpoint=new URL('/game-state',br2Online.worker).href;
        var response=await fetch(endpoint,{method:'GET',cache:'no-store'});
        if(!response.ok) throw new Error('ดาวน์โหลดจุดเซฟไม่สำเร็จ ('+response.status+')');
        var bytes=new Uint8Array(await response.arrayBuffer());
        if(!bytes.length) throw new Error('ไฟล์จุดเซฟว่างเปล่า');
        await robustLoadState(bytes);
        await wait(1500);
        saveTag=lsHash(bytes);
        log('Lockstep: โหลดจุดเซฟแล้ว ('+(bytes.length/1048576).toFixed(2)+' MB)','ok');
      }catch(e){
        // โหลดเซฟไม่ได้ → รีเซ็ตเกมระหว่างหยุด ให้ทั้งสองเครื่องเริ่มจากหน้าแรกพร้อมกัน
        try{ showLog(); log('Lockstep: '+(e&&e.message||e)+' → เริ่มจากหน้าแรกของเกม','err'); }catch(_){ }
        lsCmd(M,'_cmd_reset'); await wait(800);
      }
      Atomics.store(LS.B,0,1);   // ล็อก: ห้ามเดินเฟรมจนกว่าทั้งสองเครื่องพร้อม
      await wait(250);
      lsCmd(M,'_cmd_unpause');   // รอใช้ในเฟรมแรกที่ปล่อย
      LS.fp=lsFingerprint()+'|'+saveTag; LS.myReady=true; lsSendReady(true); lsTryStart(); lsShow();
    }
    function lsOnMessage(ev){
      var d; try{ d=JSON.parse(ev.data); }catch(_){ return; }
      if(d.t){
        if(d.p===br2Online.role) return;
        if(rsOnMessage(d)) return;
        if(d.t==='i'){ if(typeof d.f==='number'&&LS.remote[d.f]===undefined&&d.f>LS.avail) LS.remote[d.f]=d.b|0; lsPump(); }
        else if(d.t==='rdy'){ LS.peerFp=String(d.fp||''); if(d.ask) lsSendReady(false); lsTryStart(); lsShow(); }
        else if(d.t==='ping'){ lsSendRaw({t:'pong',p:br2Online.role,ts:d.ts}); }
        else if(d.t==='pong'){ if(d.ts){ var r=performance.now()-d.ts; LS.rtt=LS.rtt?LS.rtt*0.7+r*0.3:r; LS.lastPong=Date.now();
            // ปรับค่าหน่วงอัตโนมัติตาม ping: ส่งทางเดียวใช้ ~rtt/2 → แปลงเป็นเฟรม + เผื่อ 2 เฟรม
            if(!LS.fixedDelay){ var want=Math.min(15,Math.max(3,Math.ceil(LS.rtt/2/16.7)+2)); if(want>LS.delay||want<LS.delay-1) LS.delay=want; } } }
        return;
      }
      if(d.type==='state'&&d.room){
        var players=Array.isArray(d.room.players)?d.room.players:[];
        var idx=players.findIndex(function(x){return x&&x.id===br2Online.playerId;});
        if(idx<0){ br2Online.role=0; LS.error='ไม่พบผู้เล่นนี้ในห้อง'; lsShow(); return; }
        br2Online.role=idx+1; br2Online.ready=players.length===2; lsShow();
      }
    }
    function lsConnect(){
      clearTimeout(LS.reconnectTimer);
      var u; try{ u=new URL(br2Online.worker); u.protocol=u.protocol==='http:'?'ws:':'wss:'; u.pathname='/room/'+br2Online.room+'/ws'; u.search=''; u.searchParams.set('playerId',br2Online.playerId); u.hash=''; }catch(_){ br2Status('ออนไลน์: URL เซิร์ฟเวอร์ไม่ถูกต้อง',false); return; }
      var ws; try{ ws=new WebSocket(u.href); }catch(e){ br2Status('ออนไลน์: '+(e.message||'เปิดการเชื่อมต่อไม่ได้'),false); return; }
      LS.ws=ws; br2Online.socket=ws;
      ws.onopen=function(){
        // ต่อใหม่หลังหลุด: ส่งปุ่มที่อีกเครื่องอาจยังไม่ได้รับซ้ำอีกครั้ง
        if(LS.started){ for(var f=LS.avail+1;f<=LS.sent;f++){ if(LS.local[f]!==undefined) lsSendRaw({t:'i',p:br2Online.role,f:f,b:LS.local[f]}); } }
        lsSendReady(true); lsShow();
      };
      ws.onmessage=lsOnMessage;
      ws.onclose=function(){ if(LS.ws!==ws) return; br2Status('ห้อง '+br2Online.room+' · หลุดการเชื่อมต่อ กำลังต่อใหม่…',false); LS.reconnectTimer=setTimeout(lsConnect,1500); };
      ws.onerror=function(){};
    }
    function br2ConnectFromUrl(){
      var q; try{ q=new URLSearchParams(location.search); }catch(_){ return; }
      br2Online.room=(q.get('room')||'').toUpperCase(); br2Online.playerId=q.get('playerId')||''; br2Online.worker=q.get('worker')||br2Online.worker;
      var dl=parseInt(q.get('delay')||'',10); if(dl>=1&&dl<=15){ LS.delay=dl; LS.fixedDelay=true; }
      if(!/^[A-Z0-9]{6}$/.test(br2Online.room)||!br2Online.playerId){ br2Status('หน้านี้สำหรับเล่นออนไลน์\nกรุณาเข้าผ่านหน้า "ห้องออนไลน์"',false); return; }
      lsConnect(); rsMakeButton();
      LS.pumpTimer=setInterval(lsPump,4);
      setInterval(function(){ lsSendRaw({t:'ping',p:br2Online.role,ts:performance.now()}); lsShow(); },1000);
      // บันทึกวิเคราะห์: จำนวนครั้งที่ตัวเกมอ่านปุ่มต่อ 1 เฟรมล็อก (ปกติควรเท่ากันทุกเฟรม)
      var lsDiagLast='';
      setInterval(function(){ if(!LS.started||!LS.B) return; var B=LS.B;
        var t='อ่านปุ่ม/เฟรม 0:'+B[9]+' 1:'+B[10]+' 2:'+B[11]+' 3+:'+B[12]+' · เปลี่ยน '+B[14]+' ครั้ง (ล่าสุดเฟรม '+B[15]+')';
        if(t!==lsDiagLast){ lsDiagLast=t; try{ log('วิเคราะห์: '+t,'muted'); }catch(_){ } } },10000);
    }
    window.addEventListener('beforeunload',function(){ try{ if(LS.ws) LS.ws.close(); }catch(_){ } });
    br2ConnectFromUrl();
