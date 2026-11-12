    // ---------- BR2: อ่านไฟล์เกมจาก OPFS ผ่าน Worker (แก้ iOS 17) ----------
    // Safari บน iOS 17 อ่านไฟล์ OPFS ขนาดใหญ่ผ่าน getFile().slice() ไม่ได้ ("The I/O read operation failed")
    // จึงอ่านด้วย createSyncAccessHandle ใน Worker แทน (วิธีเดียวกับตอนเขียนไฟล์ ใช้ได้ทั้ง iOS 17 และ 18)
    // คืนค่าเป็นรายการชิ้นละ chunk ไบต์ ให้ writeFile ของตัวจำลองใช้ต่อได้ทันที
    window.br2OpfsReadPieces = async function(fileName, size, chunk, onProgress) {
      var src = `
        var access = null;
        self.onmessage = async function(e) {
          var m = e.data || {};
          try {
            if (m.type === 'open') {
              var root = await self.navigator.storage.getDirectory();
              var h = await root.getFileHandle(m.fileName);
              access = await h.createSyncAccessHandle();
              self.postMessage({id:m.id, ok:true, size:access.getSize()});
            } else if (m.type === 'read') {
              var buf = new Uint8Array(m.length), done = 0;
              while (done < m.length) {
                var n = access.read(buf.subarray(done), {at:m.offset + done});
                if (!n || n < 0) throw new Error('อ่าน OPFS ได้ไม่ครบที่ไบต์ ' + (m.offset + done));
                done += n;
              }
              self.postMessage({id:m.id, ok:true, buffer:buf.buffer}, [buf.buffer]);
            } else if (m.type === 'close') {
              if (access) { access.close(); access = null; }
              self.postMessage({id:m.id, ok:true});
            }
          } catch (err) { self.postMessage({id:m.id, ok:false, error:(err && err.message) || String(err)}); }
        };`;
      var url = URL.createObjectURL(new Blob([src], {type:'text/javascript'}));
      var worker = new Worker(url), seq = 0, pending = {};
      worker.onmessage = function(e) { var m = e.data || {}, t = pending[m.id]; if (!t) return; delete pending[m.id]; if (m.ok) t.resolve(m); else t.reject(new Error(m.error || 'OPFS reader error')); };
      worker.onerror = function(e) { Object.keys(pending).forEach(function(k) { pending[k].reject(new Error(e.message || 'OPFS reader หยุดทำงาน')); delete pending[k]; }); };
      function ask(type, data) { return new Promise(function(resolve, reject) { var id = ++seq; pending[id] = {resolve:resolve, reject:reject}; worker.postMessage(Object.assign({type:type, id:id}, data || {})); }); }
      try {
        var info = await ask('open', {fileName:fileName});
        if (info.size !== size) throw new Error('ขนาดไฟล์ OPFS ไม่ตรง (' + info.size + '/' + size + ')');
        var pieces = [];
        for (var off = 0; off < size; off += chunk) {
          var r = await ask('read', {offset:off, length:Math.min(chunk, size - off)});
          pieces.push(new Uint8Array(r.buffer));
          if (onProgress) onProgress(off + r.buffer.byteLength, size);
        }
        try { await ask('close'); } catch (_) {}
        return pieces;
      } finally { worker.terminate(); URL.revokeObjectURL(url); }
    };

