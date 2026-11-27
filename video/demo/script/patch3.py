p = "script/build.mjs"
s = open(p, encoding="utf8").read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)
# Frame 0 is the thumbnail: the real number is already there and pops once.
rep('''      const counter = { value: 0 };
      const numEl = document.getElementById("hook-count");
      tl.to(counter, { value: 12000, duration: 1.5, ease: "power3.out", onUpdate: () => { numEl.textContent = Math.round(counter.value).toLocaleString("en-US"); } }, 0);
      tl.set(numEl, { textContent: "12,000" }, 1.6);''', '''      tl.fromTo("#hook-count", { scale: 0.92, transformOrigin: "left bottom" }, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.05);''')
rep('<span id="hook-count">0</span>', '<span id="hook-count" style="display:inline-block">12,000</span>')
# Shelter pills wrap inside the safe area.
rep('.shelters { position: absolute; left: 160px; top: 790px; display: flex; gap: 14px; }', '.shelters { position: absolute; left: 160px; top: 760px; width: 1600px; display: flex; flex-wrap: wrap; gap: 14px; }')
# Origin pills: one row, clear of the caption band.
rep('<span><b>reliefmesh_command</b> localhost:8080</span><span><b>shelterconnect</b> localhost:8081</span><span><b>aidsupply</b> localhost:8082</span><span><b>trustregistry</b> localhost:8083</span><span><b>routebridge</b> localhost:8084</span>',
    '<span><b>reliefmesh_command</b> :8080</span><span><b>shelterconnect</b> :8081</span><span><b>aidsupply</b> :8082</span><span><b>trustregistry</b> :8083</span><span><b>routebridge</b> :8084</span>')
rep('.origins { position: absolute; left: 160px; top: 820px;', '.origins { position: absolute; left: 160px; top: 790px;')
# Chapter labels paint above the camera layer.
rep('.chapter { position: absolute; left: 160px; top: 20px;', '.chapter { position: absolute; z-index: 3; left: 160px; top: 20px;')
rep('.cam { position: absolute; inset: 0; transform-origin: 50% 50%; }', '.cam { position: absolute; z-index: 1; inset: 0; transform-origin: 50% 50%; }')
open(p, "w", encoding="utf8", newline="\n").write(s)
print("patched")
