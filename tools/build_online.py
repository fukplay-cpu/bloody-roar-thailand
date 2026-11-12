#!/usr/bin/env python3
"""Build play-online.html from the working single-player page.

Usage:  python3 tools/build_online.py
Source: play-ios18-fixed-v5-thai-menu-fix6.html  (unchanged)
Output: play-online.html

What it changes:
  1. Core JS (base64 in <script id="core-js">): adds the lockstep frame gate so the
     emulator only runs a frame when both players' inputs for that frame are known,
     and injects those inputs straight into RetroArch's keyboard callbacks.
  2. Page script: replaces the old online input bridge with the lockstep client,
     and turns off things that would make the two machines differ
     (auto-save, resume from save, pause when the app is in the background,
     RetroArch hotkeys that collide with P2 keys, core auto-frameskip).
  3. Core memory: falls back to a smaller shared-memory maximum when the
     browser refuses the default 2 GB ("Out of memory" on some iPhones).
  4. Disc files downloaded into OPFS are read through a Worker sync handle
     (tools/opfs-reader.js) — iOS 17 Safari fails on getFile().slice().
Resync after a network stall is handled in tools/lockstep-page.js.
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "play-ios18-fixed-v5-thai-menu-fix6.html"
OUT = ROOT / "play-online.html"
PRELUDE = (ROOT / "tools" / "lockstep-core-prelude.js").read_text(encoding="utf-8")
PAGE_JS = (ROOT / "tools" / "lockstep-page.js").read_text(encoding="utf-8")
OPFS_READER = (ROOT / "tools" / "opfs-reader.js").read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        sys.exit(f"[{label}] expected exactly 1 match, found {count}")
    return text.replace(old, new)


def patch_core(js):
    js = PRELUDE + "\n" + js
    # 1) frame gate inside Emscripten's main loop runner
    js = replace_once(
        js,
        "MainLoop.runIter(iterFunc);if(!checkIsRunning())return;MainLoop.scheduler()};",
        "if(globalThis.__br2Gate&&!globalThis.__br2Gate()){if(MainLoop.timingMode==1&&MainLoop.scheduler)MainLoop.scheduler();else setTimeout(MainLoop.runner,1);return}"
        "MainLoop.runIter(iterFunc);if(!checkIsRunning())return;MainLoop.scheduler()};",
        "main-loop gate",
    )
    # 2) remember RetroArch's keyboard callbacks in the thread that registers them,
    #    and provide a synchronous key injector for the gate
    injector = (
        "globalThis.__br2Key=(typeId,code)=>{var cbs=globalThis.__br2kcb||[];"
        "var ev=globalThis.__br2kev||(globalThis.__br2kev=_malloc(160));"
        "for(var r of cbs){if(r.id!==typeId)continue;growMemViews();"
        "HEAPF64[ev>>3]=0;var idx=ev>>2;HEAP32[idx+2]=0;"
        "HEAP8[ev+12]=0;HEAP8[ev+13]=0;HEAP8[ev+14]=0;HEAP8[ev+15]=0;HEAP8[ev+16]=0;"
        "HEAP32[idx+5]=0;HEAP32[idx+6]=0;HEAP32[idx+7]=0;"
        "stringToUTF8(code,ev+32,32);stringToUTF8(code,ev+64,32);"
        "stringToUTF8('',ev+96,32);stringToUTF8('',ev+128,32);"
        "try{getWasmTableEntry(r.cb)(typeId,ev,r.ud)}catch(e){}}};"
    )
    js = replace_once(
        js,
        "function _emscripten_set_keydown_callback_on_thread(target,userData,useCapture,callbackfunc,targetThread){",
        injector
        + "function _emscripten_set_keydown_callback_on_thread(target,userData,useCapture,callbackfunc,targetThread){"
        "(globalThis.__br2kcb||=[]).push({id:2,cb:callbackfunc,ud:userData});",
        "keydown record",
    )
    js = replace_once(
        js,
        "function _emscripten_set_keyup_callback_on_thread(target,userData,useCapture,callbackfunc,targetThread){",
        "function _emscripten_set_keyup_callback_on_thread(target,userData,useCapture,callbackfunc,targetThread){"
        "(globalThis.__br2kcb||=[]).push({id:3,cb:callbackfunc,ud:userData});",
        "keyup record",
    )
    # 3) pthread worker receives the shared input buffer from the page
    js = replace_once(
        js,
        "var msgData=e.data;var cmd=msgData.cmd;if(cmd==1){",
        "var msgData=e.data;var cmd=msgData.cmd;"
        "if(cmd===\"br2lock\"){globalThis.__br2i=new Int32Array(msgData.sab);globalThis.__br2codes=msgData.codes;return}"
        "if(cmd==1){",
        "worker message",
    )
    # 4) let the page reach the pthread workers
    js = replace_once(
        js,
        'Module["pauseMainLoop"]=MainLoop.pause;',
        'Module["pauseMainLoop"]=MainLoop.pause;Module["__br2PThread"]=PThread;',
        "expose PThread",
    )
    # 5) "Out of memory" at 0% on some iPhones: the core reserves a 2 GB shared
    #    memory up front and Safari refuses it. Try 2 GB, then fall back to
    #    smaller maximums (the wasm accepts any maximum <= its declared one).
    js = replace_once(
        js,
        "wasmMemory=new WebAssembly.Memory({initial:INITIAL_MEMORY/65536,maximum:32768,shared:true})",
        "wasmMemory=null;for(var __br2mx of [32768,16384,12288,8192]){try{"
        "wasmMemory=new WebAssembly.Memory({initial:INITIAL_MEMORY/65536,maximum:__br2mx,shared:true});"
        "globalThis.__br2MemMax=__br2mx;break}catch(__br2e){if(__br2mx===8192)throw __br2e}}",
        "memory fallback",
    )
    return js


def main():
    html = SRC.read_text(encoding="utf-8")

    # --- core js ---
    m = re.search(r'(<script type="text/plain" id="core-js">)(.*?)(</script>)', html, re.S)
    if not m:
        sys.exit("core-js block not found")
    core = base64.b64decode(re.sub(r"\s", "", m.group(2))).decode("utf-8")
    core = patch_core(core)
    b64 = base64.b64encode(core.encode("utf-8")).decode("ascii")
    html = html[: m.start(2)] + b64 + html[m.end(2):]

    # --- page script: swap the online bridge for the lockstep client ---
    start = html.index("// ---------- BR2 online input bridge")
    end_marker = "br2ConnectFromUrl();"
    end = html.index(end_marker, start) + len(end_marker)
    html = html[:start] + PAGE_JS.strip() + html[end:]

    # hook right after the emulator has launched
    n = html.count("ng=await Nostalgist.launch(opts);")
    if n < 1:
        sys.exit("launch hook not found")
    html = html.replace(
        "ng=await Nostalgist.launch(opts);",
        "ng=await Nostalgist.launch(opts);try{if(window.__br2AfterLaunch)window.__br2AfterLaunch();}catch(_){}",
    )

    # things that would make the two machines run differently
    html = replace_once(html, "function startAutoSave(){", "function startAutoSave(){ if(window.__br2Lockstep) return;", "autosave")
    html = html.replace("if(pendingResumeId===romId){", "if(pendingResumeId===romId&&!window.__br2Lockstep){")
    html = replace_once(
        html,
        "c.savestate_thumbnail_enable=false;",
        "c.savestate_thumbnail_enable=false; c.pause_nonactive=false; c.rewind_enable=false; c.run_ahead_enabled=false;"
        # RetroArch hotkeys that collide with the P2 keyboard bindings (P2 start = F1 = menu,
        # P2 square = O = movie record, ...) would change emulator state outside lockstep.
        " c.savestate_auto_load=false; c.input_menu_toggle='nul'; c.input_bsv_record_toggle='nul'; c.input_osk_toggle='nul';"
        " c.input_toggle_slowmotion='nul'; c.input_close_content='nul'; c.input_toggle_statistics='nul'; c.input_menu_toggle_gamepad_combo=0;",
        "retroarch cfg",
    )
    # the core must never skip frames on its own (auto frameskip reacts to the audio buffer,
    # which empties during a network stall → the two machines would emulate differently)
    html = replace_once(
        html,
        "pcsx_rearmed_pad1type:'dualshock' };",
        "pcsx_rearmed_pad1type:'dualshock', pcsx_rearmed_frameskip_type:'disabled', pcsx_rearmed_frameskip:'0' };",
        "core cfg",
    )
    # "Out of memory" in expandFileStorage on iPhone: MEMFS keeps a file as ONE
    # contiguous Uint8Array, and Safari refuses a single allocation the size of the
    # whole disc. Keep big disc files as a list of 8 MB pieces instead (same total
    # memory, no huge block, no copy) and serve reads from those pieces.
    old_write = (
        '\t\t\t\tconst stream = FS.open(filePath, "w");\n'
        "\t\t\t\t// Pré-alloue la taille finale → MEMFS n'agrandit plus par doublement (pic ~2× → OOM iPhone).\n"
        "\t\t\t\ttry { FS.truncate(filePath, blob.size); } catch {}\n"
        "\t\t\t\tconst CHUNK = 8 * 1024 * 1024;\n"
        "\t\t\t\tfor (let off = 0; off < blob.size; off += CHUNK) {\n"
        "\t\t\t\t\tconst chunk = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());\n"
        "\t\t\t\t\tFS.write(stream, chunk, 0, chunk.length, off);\n"
        "\t\t\t\t}\n"
        "\t\t\t\tFS.close(stream);\n"
        "\t\t\t\treturn;\n"
    )
    new_write = (
        "\t\t\t\t// BR2: ไฟล์แผ่นเกมเก็บเป็นชิ้นละ 8 MB (ไม่ต้องจองแรมก้อนใหญ่ก้อนเดียว → ไม่ Out of memory บน iPhone)\n"
        "\t\t\t\tconst CHUNK = 8 * 1024 * 1024, size = blob.size;\n"
        "\t\t\t\tlet pieces = [];\n"
        "\t\t\t\t// ไฟล์ที่ดาวน์โหลดเก็บใน OPFS: อ่านผ่าน Worker (iOS 17 อ่านด้วย slice() ไม่ได้)\n"
        "\t\t\t\tif (blob.__br2OpfsName && typeof window !== \"undefined\" && window.br2OpfsReadPieces) {\n"
        "\t\t\t\t\ttry { pieces = await window.br2OpfsReadPieces(blob.__br2OpfsName, size, CHUNK); }\n"
        "\t\t\t\t\tcatch (err) { console.warn(\"BR2 OPFS worker read failed, falling back to slice()\", err); pieces = []; }\n"
        "\t\t\t\t}\n"
        "\t\t\t\tif (!pieces.length) for (let off = 0; off < size; off += CHUNK) {\n"
        "\t\t\t\t\tfor (let tries = 1; ; tries++) {\n"
        "\t\t\t\t\t\ttry { pieces.push(new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer())); break; }\n"
        "\t\t\t\t\t\tcatch (err) {\n"
        "\t\t\t\t\t\t\tif (tries >= 3) throw new Error(\"อ่านไฟล์เกมไม่ได้ที่ \" + Math.round(off / 1048576) + \"/\" + Math.round(size / 1048576) + \" MB (แรมเครื่องอาจไม่พอ) — \" + (err && err.message || err));\n"
        "\t\t\t\t\t\t\tawait new Promise(r => setTimeout(r, 400 * tries));\n"
        "\t\t\t\t\t\t}\n"
        "\t\t\t\t\t}\n"
        "\t\t\t\t}\n"
        "\t\t\t\ttry { FS.unlink(filePath); } catch {}\n"
        "\t\t\t\tFS.writeFile(filePath, new Uint8Array(0), { encoding: \"binary\" });\n"
        "\t\t\t\tconst node = FS.lookupPath(filePath).node;\n"
        "\t\t\t\tnode.contents = new Uint8Array(0); node.usedBytes = size; node.br2Pieces = pieces;\n"
        "\t\t\t\tnode.stream_ops = Object.assign({}, node.stream_ops, {\n"
        "\t\t\t\t\tread(stream, buffer, offset, length, position) {\n"
        "\t\t\t\t\t\tconst n = stream.node; if (position >= n.usedBytes) return 0;\n"
        "\t\t\t\t\t\tlet todo = Math.min(n.usedBytes - position, length), done = 0;\n"
        "\t\t\t\t\t\twhile (todo > 0) {\n"
        "\t\t\t\t\t\t\tconst p = n.br2Pieces[Math.floor(position / CHUNK)], at = position % CHUNK, k = Math.min(todo, p.length - at);\n"
        "\t\t\t\t\t\t\tbuffer.set(p.subarray(at, at + k), offset + done); done += k; position += k; todo -= k;\n"
        "\t\t\t\t\t\t}\n"
        "\t\t\t\t\t\treturn done;\n"
        "\t\t\t\t\t},\n"
        "\t\t\t\t\twrite() { throw new FS.ErrnoError(63); },\n"
        "\t\t\t\t\tmmap() { throw new FS.ErrnoError(43); }\n"
        "\t\t\t\t});\n"
        "\t\t\t\treturn;\n"
    )
    html = replace_once(html, old_write, new_write, "chunked disc file")
    # files downloaded into OPFS (even the small .cue) also go through the worker reader
    html = replace_once(
        html,
        'if (blob && typeof blob.slice === "function" && blob.size > 16 * 1024 * 1024) {',
        'if (blob && typeof blob.slice === "function" && (blob.size > 16 * 1024 * 1024 || blob.__br2OpfsName)) {',
        "opfs small files",
    )
    html = replace_once(
        html,
        "files.push(extractedFile);",
        "try { extractedFile.__br2OpfsName = safeName; } catch (_) {} files.push(extractedFile);",
        "mark opfs file",
    )
    html = replace_once(
        html,
        "    async function br2CreateOpfsWriter(fileName) {",
        OPFS_READER.rstrip("\n") + "\n    async function br2CreateOpfsWriter(fileName) {",
        "opfs reader",
    )
    html = replace_once(html, "<title>", "<title>BR2 Online · ", "title")

    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.name} ({OUT.stat().st_size/1048576:.2f} MB), launch hooks: {n}")


if __name__ == "__main__":
    main()
