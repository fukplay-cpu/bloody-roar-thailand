#!/usr/bin/env python3
"""สร้าง play-filter-test.html จากหน้าเกมหลัก (ไม่แก้หน้าเกมหลัก)
เพิ่มฟิลเตอร์ขยายภาพ (shader จาก libretro/glsl-shaders, MIT — เก็บหัวลิขสิทธิ์ไว้ในไฟล์ shader)
เลือกฟิลเตอร์ด้วย ?filter=<ชื่อ> หรือเมนูลอยมุมจอ"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'play-ios18-fixed-v5-thai-menu-fix6.html'
OUT = ROOT / 'play-filter-test.html'
SH = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/gs')
FILTERS = {
  # ชื่อ: (ไฟล์ glsl, ข้อความ glslp ที่ใช้ — ไม่มี scale_type = วาดตรงลงจอ)
  'xbr-lv2':    ('xbr/shaders/xbr-lv2.glsl',    'shaders = 1\nshader0 = shaders/f.glsl\nfilter_linear0 = false\n'),
  'xbr-lv3':    ('xbr/shaders/xbr-lv3.glsl',    'shaders = 1\nshader0 = shaders/f.glsl\nfilter_linear0 = false\n'),
  'xbr-lv2-3d': ('xbr/shaders/xbr-lv2-3d.glsl', 'shaders = 1\nshader0 = shaders/f.glsl\nfilter_linear0 = false\n'),
  'xbrz':       ('xbrz/shaders/xbrz-freescale.glsl', 'shaders = 1\nshader0 = shaders/f.glsl\nfilter_linear0 = false\n'),
}
s = SRC.read_text(encoding='utf-8')
data = {k: {'glslp': p, 'glsl': (SH / f).read_text(encoding='utf-8')} for k, (f, p) in FILTERS.items()}
inject = """
    // ===== หน้าทดสอบฟิลเตอร์: เลือกด้วย ?filter= (สร้างโดย tools/build_filter_test.py) =====
    var BR2_FILTERS=%s;
    var br2Filter=(function(){ try{ var q=new URLSearchParams(location.search).get('filter'); return (q&&BR2_FILTERS[q])?q:''; }catch(_){ return ''; } })();
    function shaderOpts(){
      if(br2Filter){ var F=BR2_FILTERS[br2Filter]; log('ฟิลเตอร์ทดสอบ: '+br2Filter,'ok');
        return { shader:'f', resolveShader:function(){ return [
          { fileName:'f.glslp', fileContent:new Blob([F.glslp],{type:'text/plain'}) },
          { fileName:'f.glsl',  fileContent:new Blob([F.glsl],{type:'text/plain'}) } ]; } }; }
      return shaderOptsOrig(); }
    (function(){ var d=document.createElement('div'); d.style.cssText='position:fixed;left:6px;bottom:6px;z-index:99999;background:#000c;border:1px solid #c9a24b;border-radius:8px;padding:4px 6px;font:12px system-ui;color:#ffd27a';
      var sel=document.createElement('select'); [['','ไม่มีฟิลเตอร์ (เหมือนเกมหลัก)']].concat(Object.keys(BR2_FILTERS).map(function(k){ return [k,k]; })).forEach(function(o){ var e=document.createElement('option'); e.value=o[0]; e.textContent=o[1]; if(o[0]===br2Filter) e.selected=true; sel.appendChild(e); });
      sel.onchange=function(){ var u=new URL(location.href); if(sel.value) u.searchParams.set('filter',sel.value); else u.searchParams.delete('filter'); location.href=u.href; };
      d.appendChild(document.createTextNode('🧪 ฟิลเตอร์: ')); d.appendChild(sel);
      function add(){ document.body.appendChild(d); } if(document.body) add(); else document.addEventListener('DOMContentLoaded',add); })();
""" % json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
old = '    function shaderOpts(){\n      if(!dotMode) return {};'
assert s.count(old) == 1
s = s.replace(old, inject + '    function shaderOptsOrig(){\n      if(!dotMode) return {};')
s = s.replace('<title>', '<title>[ทดสอบฟิลเตอร์] ', 1)
OUT.write_text(s, encoding='utf-8')
print('wrote', OUT.name, len(s))
