p = "script/build.mjs"
s = open(p, encoding="utf8").read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)
# Every effect ends when its sound ends, so clips never overlap on a lane.
rep('const S = { whoosh: ".media/audio/sfx/sfx_003.mp3", glitch: ".media/audio/sfx/sfx_005.mp3", click: ".media/audio/sfx/sfx_004.mp3", pop: ".media/audio/sfx/sfx_006.mp3", riser: ".media/audio/sfx/sfx_002.mp3" };',
    'const S = { whoosh: ".media/audio/sfx/sfx_003.mp3", glitch: ".media/audio/sfx/sfx_005.mp3", click: ".media/audio/sfx/sfx_004.mp3", pop: ".media/audio/sfx/sfx_006.mp3", riser: ".media/audio/sfx/sfx_002.mp3" };\nconst SD = { whoosh: 0.6, glitch: 1.6, click: 0.4, pop: 0.7, riser: 10.03 };')
rep('data-start="${at}" data-volume="${volume}" data-track-index=', 'data-start="${at}" data-duration="${SD[name]}" data-volume="${volume}" data-track-index=')
# Inactive caption words at 3:1 on the pill.
rep('.cw { display: inline-block; margin: 0 7px; font-size: 44px; font-weight: 700; line-height: 1.2; color: #a6a6a6; }', '.cw { display: inline-block; margin: 0 7px; font-size: 44px; font-weight: 700; line-height: 1.2; color: #767676; }')
rep('tl.set(s, { color: wi === 0 ? "#1c1e1d" : "#a6a6a6" }, start);', 'tl.set(s, { color: wi === 0 ? "#1c1e1d" : "#767676" }, start);')
open(p, "w", encoding="utf8", newline="\n").write(s)
print("patched")
