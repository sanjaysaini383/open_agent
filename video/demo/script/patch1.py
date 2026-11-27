p = "script/build.mjs"
s = open(p, encoding="utf8").read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)
rep('const TOTAL = r2(meta.total + 1.1);', 'const TOTAL = r2(meta.total + 2.4);')
rep('.eyebrow { position: absolute; left: 160px; top: 116px; display: flex; align-items: center; gap: 14px; font-size: 22px;', '.eyebrow { position: absolute; left: 160px; top: 110px; display: flex; align-items: center; gap: 14px; font-size: 28px;')
rep('.chapter { position: absolute; left: 160px; top: 24px; display: flex; align-items: center; gap: 14px; font-size: 20px;', '.chapter { position: absolute; left: 160px; top: 20px; display: flex; align-items: center; gap: 14px; font-size: 28px;')
rep('.site span { display: block; margin-top: 4px; font-size: 18px; color: ${SAND}; }', '.site span { display: block; margin-top: 4px; font-size: 28px; color: ${SAND}; }')
rep('.site b { display: block; font-size: 26px; font-weight: 700; }', '.site b { display: block; font-size: 32px; font-weight: 700; }')
rep('.origins span { opacity: 0; padding: 10px 16px; border-radius: 999px; border: 1px solid rgba(209,232,226,0.3); font-size: 21px; color: ${MINT}; }', '.origins span { opacity: 0; padding: 10px 18px; border-radius: 999px; border: 1px solid rgba(209,232,226,0.3); font-size: 28px; color: ${MINT}; }')
rep('.fact span small { display: block; margin-top: 4px; font-size: 20px; color: ${SAND}; font-family: "JetBrains Mono", monospace; }', '.fact span small { display: block; margin-top: 6px; font-size: 28px; color: ${SAND}; font-family: "JetBrains Mono", monospace; }')
rep('.url small { display: block; margin-top: 14px; font-family: Inter, sans-serif; font-size: 22px; color: ${SAND}; opacity: 0; }', '.url small { display: block; margin-top: 16px; font-family: Inter, sans-serif; font-size: 28px; color: ${SAND}; opacity: 0; }')
rep('<span class="pill" id="${id}-pill">${pill}</span>', '<span class="pill" id="${id}-pill" data-layout-ignore>${pill}</span>')
rep('.shelters span { padding: 12px 18px; border: 1px solid rgba(234,231,220,0.22); border-radius: 10px; font-size: 24px;', '.shelters span { padding: 12px 18px; border: 1px solid rgba(234,231,220,0.22); border-radius: 10px; font-size: 28px;')
rep('.num { position: absolute; left: 160px; top: 300px;', '.num { position: absolute; left: 160px; top: 220px;')
rep('.shelters { position: absolute; left: 160px; top: 700px;', '.shelters { position: absolute; left: 160px; top: 790px;')
rep('<div class="title" style="top: 540px" id="hook-title">', '<div class="title" style="top: 450px" id="hook-title">')
rep('''      show("#hook-eyebrow", 0.1, { y: 8 });
      const counter = { value: 0 };
      const numEl = document.getElementById("hook-count");
      tl.fromTo("#hook-num", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.3);
      tl.to(counter, { value: 12000, duration: 1.4, ease: "power3.out", onUpdate: () => { numEl.textContent = Math.round(counter.value).toLocaleString("en-US"); } }, 0.4);
      tl.set(numEl, { textContent: "12,000" }, 1.9);''', '''      tl.set("#hook-eyebrow", { opacity: 1 }, 0);
      tl.set("#hook-num", { opacity: 1 }, 0);
      const counter = { value: 0 };
      const numEl = document.getElementById("hook-count");
      tl.to(counter, { value: 12000, duration: 1.5, ease: "power3.out", onUpdate: () => { numEl.textContent = Math.round(counter.value).toLocaleString("en-US"); } }, 0);
      tl.set(numEl, { textContent: "12,000" }, 1.6);''')
rep('<div class="num" id="hook-num"><span id="hook-count">0</span> <b>people</b></div>', '<div class="num" id="hook-num" style="opacity: 1"><span id="hook-count">0</span> <b>people</b></div>')
rep('<div class="eyebrow" id="hook-eyebrow"><i></i>', '<div class="eyebrow" id="hook-eyebrow" style="opacity: 1"><i></i>')
rep('<div class="sub" style="top: 610px" id="rev-sub">', '<div class="sub" style="top: 690px" id="rev-sub">')
rep('.origins { position: absolute; left: 160px; top: 720px;', '.origins { position: absolute; left: 160px; top: 820px;')
rep('<div class="title" style="top: 470px" id="rev-title">', '<div class="title" style="top: 440px" id="rev-title">')
rep('<div class="clip" data-start="0" data-duration="${r2(L.tension.start)}">', '<div id="hook-clip" class="clip" data-start="0" data-duration="${r2(L.tension.start)}">')
rep('<div class="clip" data-start="0" data-duration="${r2(L.reveal.start - L.tension.start)}">', '<div id="ten-clip" class="clip" data-start="0" data-duration="${r2(L.reveal.start - L.tension.start)}">')
rep('<div class="clip" data-start="0" data-duration="${r2(L.consent.start - L.reveal.start)}">', '<div id="rev-clip" class="clip" data-start="0" data-duration="${r2(L.consent.start - L.reveal.start)}">')
rep('<div class="clip" data-start="0" data-duration="${r2(L.claim.start - L.stack.start)}">', '<div id="stack-clip" class="clip" data-start="0" data-duration="${r2(L.claim.start - L.stack.start)}">')
rep('<div class="clip" data-start="0" data-duration="${END_DUR}">', '<div id="end-clip" class="clip" data-start="0" data-duration="${END_DUR}">')
rep('gsap.utils.toArray("#end-url span").forEach((el, i) => tl.set(el, { opacity: 1 }, 3.0 + i * 0.035));', 'gsap.utils.toArray("#end-url span").forEach((el, i) => tl.set(el, { opacity: 1 }, 1.4 + i * 0.03));')
rep('{ opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 4.6);', '{ opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 2.8);')
rep('''      groups.forEach((g, gi) => {
        const el = document.createElement("div"); el.className = "cg"; el.id = "cg" + gi;''', '''      let prevEnd = 0;
      groups.forEach((g, gi) => {
        const el = document.createElement("div"); el.className = "cg"; el.id = "cg" + gi;''')
rep('''        const start = Math.max(0.1, g[0].start - 0.05);
        const next = groups[gi + 1];
        const end = next ? Math.min(next[0].start - 0.05, g[g.length - 1].end + TAIL) : g[g.length - 1].end + TAIL;''', '''        const start = Math.max(0.1, g[0].start - 0.05, prevEnd + 0.02);
        const next = groups[gi + 1];
        const end = Math.max(start + 0.35, next ? Math.min(next[0].start - 0.05, g[g.length - 1].end + TAIL) : g[g.length - 1].end + TAIL);
        prevEnd = end;''')
rep('''        tl.to(el, { opacity: 0, duration: 0.1, ease: "power2.in" }, Math.max(start + 0.2, end - 0.1));
        tl.set(el, { opacity: 0, visibility: "hidden" }, Math.max(start + 0.3, end));''', '''        tl.to(el, { opacity: 0, duration: 0.1, ease: "power2.in" }, end - 0.1);
        tl.set(el, { opacity: 0, visibility: "hidden" }, end);''')
rep('''const approvalDur = dur("approval", "tracking");
const sApproval = product("s-approval", approvalDur, "06 · Human approval · the partner's own window", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: 7.6, mediaStart: 148, rate: 1.8 },
  { src: MAIN, start: 7.6, duration: 2.0, mediaStart: 169.2, rate: 1.5 },
  { src: "assets/footage/popup-2.mp4", start: 9.6, duration: r2(approvalDur - 9.6), mediaStart: 0.3, rate: 1 },
], `${pushTo(960, 540, 1.25, 2.2)}\\n      ${resetCam(7.6)}\\n      ${pushTo(960, 540, 1.55, 7.9)}\\n      ${resetCam(9.6)}\\n      tl.set("#s-approval-pill", { textContent: "localhost:8082 · AidSupply Network · its own window" }, 9.6);`);

const trackingDur = dur("tracking", "stack");
const sTracking = product("s-tracking", trackingDur, "07 · Tracking · hash-chained audit trail", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: 5.8, mediaStart: 225.6, rate: 2.5 },
  { src: MAIN, start: 5.8, duration: r2(trackingDur - 5.8), mediaStart: 246.4, rate: 1 },
], `${pushTo(1400, 620, 1.4, 0.3)}\\n      ${resetCam(5.8)}\\n      ${pushTo(960, 300, 1.3, 5.9, 0.4)}`);''', '''const approvalDur = dur("approval", "tracking");
const A1 = 7.6, A2 = 2.0, A3 = r2(approvalDur - A1 - A2);
const sApproval = product("s-approval", A1, "06 · Human approval", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: A1, mediaStart: 148, rate: 1.8 },
], `${pushTo(960, 540, 1.25, 2.2)}`);
const sPrompt = product("s-prompt", A2, "06 · The partner's own window", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: A2, mediaStart: 169.2, rate: 1.5 },
], `${pushTo(960, 540, 1.55, 0.5, 0.4)}`);
const sWindow = product("s-window", A3, "06 · Confirmed on the supplier's origin", "localhost:8082 · AidSupply Network · its own window", [
  { src: "assets/footage/popup-2.mp4", start: 0, duration: A3, mediaStart: 0.3, rate: 1 },
], ``);

const trackingDur = dur("tracking", "stack");
const T1 = 5.8, T2 = r2(trackingDur - T1);
const sTracking = product("s-tracking", T1, "07 · Tracking", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: T1, mediaStart: 225.6, rate: 2.5 },
], `${pushTo(1400, 620, 1.4, 0.5)}`);
const sAudit = product("s-audit", T2, "07 · Hash-chained audit trail", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: T2, mediaStart: 246.4, rate: 1 },
], `${pushTo(960, 300, 1.3, 0.5, 0.4)}`);''')
rep('{ src: MAIN, start: 0, duration: dur("discovery", "trust"), mediaStart: 62, rate: 2.5 },\n], `${pushTo(1200, 430, 1.25, 1.2)}\\n      ${pushTo(1200, 430, 1.0, 7.6)}`);', '{ src: MAIN, start: 0, duration: dur("discovery", "trust"), mediaStart: 114.6, rate: 0.88 },\n], `${pushTo(1000, 520, 1.2, 1.0)}\\n      ${pushTo(1000, 520, 1.0, 6.4)}`);')
rep('{ src: MAIN, start: 0, duration: dur("trust", "hostile"), mediaStart: 117, rate: 1.2 },\n], `${pushTo(1100, 520, 1.45, 6.9)}`);', '{ src: MAIN, start: 0, duration: dur("trust", "hostile"), mediaStart: 124.7, rate: 0.44 },\n], `${pushTo(1100, 520, 1.45, 2.4)}`);')
rep('''  ["s-hostile", L.hostile.start, L.allocation.start], ["s-allocation", L.allocation.start, L.approval.start], ["s-approval", L.approval.start, L.tracking.start],
  ["s-tracking", L.tracking.start, L.stack.start], ["stack", L.stack.start, L.claim.start], ["endcard", L.claim.start, TOTAL],''', '''  ["s-hostile", L.hostile.start, L.allocation.start], ["s-allocation", L.allocation.start, L.approval.start],
  ["s-approval", L.approval.start, L.approval.start + A1], ["s-prompt", L.approval.start + A1, L.approval.start + A1 + A2], ["s-window", L.approval.start + A1 + A2, L.tracking.start],
  ["s-tracking", L.tracking.start, L.tracking.start + T1], ["s-audit", L.tracking.start + T1, L.stack.start], ["stack", L.stack.start, L.claim.start], ["endcard", L.claim.start, TOTAL],''')
rep('"s-approval": sApproval, "s-tracking": sTracking, stack, endcard, captions };', '"s-approval": sApproval, "s-prompt": sPrompt, "s-window": sWindow, "s-tracking": sTracking, "s-audit": sAudit, stack, endcard, captions };')
rep('].map(([name, at, volume], index) => `    <audio id="sfx-${index}-${name}" class="clip" src="${S[name]}" data-start="${at}" data-volume="${volume}" data-track-index="3"></audio>`).join("\\n");', '].map(([name, at, volume], index) => `    <audio id="sfx-${index}-${name}" class="clip" src="${S[name]}" data-start="${at}" data-volume="${volume}" data-track-index="${({ whoosh: 4, glitch: 4, click: 5, pop: 6, riser: 7 })[name]}"></audio>`).join("\\n");')
rep('["glitch", t("approval", 9.6), 0.4],', '["glitch", t("approval", 9.6), 0.4], ["pop", t("approval", 10.4), 0.45],')
open(p, "w", encoding="utf8", newline="\n").write(s)
print("patched")
