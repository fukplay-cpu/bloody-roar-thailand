    // ---------- BR2 ONLINE LOCKSTEP (play-online.html) ----------
    // ทั้งสองเครื่องรันเกมพร้อมกันแบบล็อกเฟรม: เฟรมถัดไปจะรันเมื่อรู้ปุ่มของทั้งสองฝั่งแล้วเท่านั้น
    // ปุ่มของเราถูกหน่วงไว้ LS.delay เฟรม เพื่อให้มีเวลาส่งถึงอีกเครื่องก่อนถึงเฟรมนั้น
    window.__br2Lockstep=true;
    var br2Online={socket:null,room:'',playerId:'',role:0,ready:false,worker:'https://br2-online-rooms.fukthefuk400.workers.dev',status:null,remoteHeld:{},startedAt:0,loadedStartedAt:0,stateLoadPromise:null};
    var LS={delay:4,fixedDelay:false,RING:256,ws:null,B:null,sab:null,local:{},remote:{},sent:-1,avail:-1,started:false,myReady:false,peerFp:null,fp:'',rtt:0,lastPong:0,lastStall:0,stallMs:0,error:'',reconnectTimer:null,pumpTimer:null};
    var LS_BTN=['up','down','left','right','a','b','x','y','l','r','l2','r2','start','select','l_x_minus','l_x_plus','l_y_minus','l_y_plus','r_x_minus','r_x_plus','r_y_minus','r_y_plus'];
    var lsHeld={}; window.__br2LS=LS;
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
      var F=LS.B?Atomics.load(LS.B,1):0;
      var waiting=LS.avail<F;
      br2Status(who+' · เฟรม '+F+'\nping '+Math.round(LS.rtt)+' ms · หน่วง '+LS.delay+' เฟรม'+(waiting?'\n⏳ รอข้อมูลจากอีกเครื่อง…':''),!waiting);
    }
    function lsPump(){
      if(!LS.started||!LS.B) return;
      var B=LS.B, F=Atomics.load(B,1);
      // สุ่มอ่านปุ่มของเราล่วงหน้า delay เฟรม แล้วส่งให้อีกเครื่อง
      while(LS.sent < F+LS.delay && LS.sent-F < LS.RING-16){
        LS.sent++; var b=lsBits(); LS.local[LS.sent]=b;
        lsSendRaw({t:'i',p:br2Online.role,f:LS.sent,b:b});
      }
      // เฟรมที่รู้ปุ่มครบทั้งสองฝั่ง → เขียนลงหน่วยความจำร่วมให้ตัวเกมใช้
      while(true){
        var n=LS.avail+1, mine=LS.local[n], theirs=LS.remote[n];
        if(mine===undefined||theirs===undefined) break;
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
        // โหลดเซฟไม่ได้ → เริ่มจากหน้าแรกของเกมแทน (ทั้งสองเครื่องจะเห็นว่า fingerprint ต่างกันถ้าอีกเครื่องโหลดได้)
        try{ showLog(); log('Lockstep: '+(e&&e.message||e)+' → เริ่มจากหน้าแรกของเกม','err'); }catch(_){ }
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
      lsConnect();
      LS.pumpTimer=setInterval(lsPump,4);
      setInterval(function(){ lsSendRaw({t:'ping',p:br2Online.role,ts:performance.now()}); lsShow(); },1000);
    }
    window.addEventListener('beforeunload',function(){ try{ if(LS.ws) LS.ws.close(); }catch(_){ } });
    br2ConnectFromUrl();
