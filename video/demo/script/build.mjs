// Generates index.html and every scene in compositions/ from SPEC.md's shot list and the
// narration timings in script/voice-meta.json. Re-run after changing either.
//   node script/build.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";

const meta = JSON.parse(await readFile("script/voice-meta.json", "utf8"));
const L = Object.fromEntries(meta.lines.map((line) => [line.beat, line]));
const r2 = (value) => Math.round(value * 100) / 100;
const TOTAL = r2(meta.total + 2.4);

// ---- palette and type (SPEC.md LOOK) ------------------------------------------------
const GROUND = "#0b0f0e";
const INK = "#eae7dc";
const MINT = "#d1e8e2";
const CORAL = "#e85a4f";
const SAND = "#d8c3a5";

const BASE_CSS = `
  #root { position: absolute; inset: 0; overflow: hidden; background: ${GROUND}; color: ${INK}; font-family: Inter, sans-serif; }
  .eyebrow { position: absolute; left: 160px; top: 110px; display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: ${MINT}; opacity: 0; }
  .eyebrow i { width: 10px; height: 10px; border-radius: 999px; background: ${CORAL}; }
  .title { position: absolute; left: 160px; width: 1600px; font-size: 84px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }
  .title .w { display: inline-block; margin-right: 0.26em; opacity: 0; filter: blur(6px); }
  .title .accent { color: ${CORAL}; }
  .sub { position: absolute; left: 160px; width: 1500px; font-size: 34px; font-weight: 500; line-height: 1.4; color: rgba(234, 231, 220, 0.72); opacity: 0; }
  .mono { font-family: "JetBrains Mono", monospace; }
`;

const word = (text, accent = false) => `<span class="w${accent ? " accent" : ""}">${text}</span>`;
const words = (text, accents = []) => text.split(" ").map((item) => word(item, accents.includes(item.replace(/[.,]/g, "")))).join("");

function scene(id, { css = "", html, script, allowOverlap = false }) {
  return `<template>
  <style>${BASE_CSS}${css}</style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080"${allowOverlap ? " data-layout-allow-overlap" : ""}>
${html}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      const landWords = (selector, at, step = 0.07) => { const list = gsap.utils.toArray(selector); list.forEach((el, i) => tl.fromTo(el, { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.16, ease: "power2.out" }, at + i * step)); return at + list.length * step + 0.16; };
      const leaveWords = (selector, at, step = 0.03) => { gsap.utils.toArray(selector).forEach((el, i) => tl.to(el, { opacity: 0, filter: "blur(6px)", duration: 0.18, ease: "power2.in" }, at + i * step)); };
      const show = (selector, at, from = {}) => tl.fromTo(selector, { opacity: 0, ...from }, { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.4, ease: "power3.out" }, at);
      const pop = (selector, at) => tl.fromTo(selector, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.4)" }, at);
${script}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}

// ---- title scenes -------------------------------------------------------------------

const hook = scene("hook", {
  css: `
    .num { position: absolute; left: 160px; top: 220px; font-size: 200px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: ${INK}; }
    .num b { color: ${CORAL}; font-weight: 700; }
    .shelters { position: absolute; left: 160px; top: 760px; width: 1600px; display: flex; flex-wrap: wrap; gap: 14px; }
    .shelters span { padding: 12px 18px; border: 1px solid rgba(234,231,220,0.22); border-radius: 10px; font-size: 28px; font-weight: 600; color: ${INK}; opacity: 0; }
  `,
  html: `
    <div id="hook-clip" class="clip" data-start="0" data-duration="${r2(L.tension.start)}">
      <div class="eyebrow" id="hook-eyebrow" style="opacity: 1"><i></i>A flood · Malda district · simulated scenario</div>
      <div class="num" id="hook-num" style="opacity: 1"><span id="hook-count" style="display:inline-block">12,000</span> <b>people</b></div>
      <div class="title" style="top: 450px" id="hook-title">${words("need food, water and medicine within 36 hours.", ["36", "hours"])}</div>
      <div class="shelters" id="hook-shelters"><span>Manikchak High School Relief Camp</span><span>Ratua Community Hall Shelter</span><span>Harishchandrapur Block Shelter</span><span>Kaliachak Primary School Camp</span></div>
    </div>`,
  script: `
      tl.set("#hook-eyebrow", { opacity: 1 }, 0);
      tl.set("#hook-num", { opacity: 1 }, 0);
      tl.fromTo("#hook-count", { scale: 0.92, transformOrigin: "left bottom" }, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, 0.05);
      landWords("#hook-title .w", 2.2);
      gsap.utils.toArray("#hook-shelters span").forEach((el, i) => pop(el, 4.1 + i * 0.22));
      leaveWords("#hook-title .w", ${r2(L.tension.start - 0.55)}, 0.02);
      tl.to(["#hook-num", "#hook-shelters", "#hook-eyebrow"], { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.tension.start - 0.25)});`,
});

const tension = scene("tension", {
  css: `
    .sites { position: absolute; left: 160px; top: 640px; display: flex; gap: 28px; align-items: center; }
    .site { opacity: 0; padding: 16px 22px; border: 1px solid rgba(234,231,220,0.22); border-radius: 12px; background: rgba(234,231,220,0.04); }
    .site b { display: block; font-size: 32px; font-weight: 700; }
    .site span { display: block; margin-top: 4px; font-size: 28px; color: ${SAND}; }
    .gap { width: 70px; height: 2px; background: repeating-linear-gradient(90deg, rgba(234,231,220,0.35) 0 8px, transparent 8px 16px); position: relative; opacity: 0; }
    .gap::after { content: "×"; position: absolute; left: 50%; top: -22px; transform: translateX(-50%); color: ${CORAL}; font-size: 30px; font-weight: 700; }
  `,
  html: `
    <div id="ten-clip" class="clip" data-start="0" data-duration="${r2(L.reveal.start - L.tension.start)}">
      <div class="eyebrow" id="ten-eyebrow"><i></i>The old way</div>
      <div class="title" style="top: 260px" id="ten-title">${words("The people who can help don't share a platform.", ["platform."])}</div>
      <div class="sub" style="top: 500px" id="ten-sub">So coordination happens by phone and spreadsheet.</div>
      <div class="sites" id="ten-sites">
        <div class="site"><b>Shelters</b><span>ShelterConnect</span></div><div class="gap"></div>
        <div class="site"><b>Suppliers</b><span>AidSupply Network</span></div><div class="gap"></div>
        <div class="site"><b>Carriers</b><span>RouteBridge</span></div><div class="gap"></div>
        <div class="site"><b>Registry</b><span>TrustRegistry</span></div>
      </div>
    </div>`,
  script: `
      show("#ten-eyebrow", 0.1, { y: 8 });
      gsap.utils.toArray("#ten-sites .site").forEach((el, i) => pop(el, 0.4 + i * 0.3));
      gsap.utils.toArray("#ten-sites .gap").forEach((el, i) => tl.fromTo(el, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.35, ease: "power2.out" }, 1.9 + i * 0.2));
      landWords("#ten-title .w", 2.6);
      show("#ten-sub", 6.2, { y: 10 });
      leaveWords("#ten-title .w", ${r2(L.reveal.start - L.tension.start - 0.55)}, 0.02);
      tl.to(["#ten-sub", "#ten-sites", "#ten-eyebrow"], { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.reveal.start - L.tension.start - 0.25)});`,
});

const MARK = `<span class="mark"><span>RM</span></span>`;
const reveal = scene("reveal", {
  css: `
    .lockup { position: absolute; left: 160px; top: 250px; display: flex; align-items: center; gap: 36px; }
    .mark { display: grid; place-items: center; width: 128px; height: 128px; border-radius: 30px; background: linear-gradient(135deg, #e98074, ${CORAL}); color: #fff; font-size: 48px; font-weight: 800; letter-spacing: 0.02em; opacity: 0; box-shadow: 0 24px 60px rgba(232,90,79,0.35); }
    .wordmark { font-size: 112px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; clip-path: inset(0 100% 0 0); }
    .wordmark small { display: block; margin-top: 6px; font-size: 22px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: ${MINT}; }
    .origins { position: absolute; left: 160px; top: 790px; display: flex; flex-wrap: wrap; gap: 14px; }
    .origins span { opacity: 0; padding: 10px 18px; border-radius: 999px; border: 1px solid rgba(209,232,226,0.3); font-size: 28px; color: ${MINT}; }
    .origins span b { color: ${INK}; font-weight: 600; }
  `,
  html: `
    <div id="rev-clip" class="clip" data-start="0" data-duration="${r2(L.consent.start - L.reveal.start)}">
      <div class="eyebrow" id="rev-eyebrow"><i></i>Open Agentic Web · official runtime, unmodified</div>
      <div class="lockup">${MARK}<div class="wordmark" id="rev-word">ReliefMesh<small>Command</small></div></div>
      <div class="title" style="top: 440px" id="rev-title">${words("Five independent websites. One open protocol.", ["open", "protocol."])}</div>
      <div class="sub" style="top: 690px" id="rev-sub">Each runs its own agents, on its own origin. Nobody has to adopt anyone's platform.</div>
      <div class="origins" id="rev-origins">
        <span><b>reliefmesh_command</b> :8080</span><span><b>shelterconnect</b> :8081</span><span><b>aidsupply</b> :8082</span><span><b>trustregistry</b> :8083</span><span><b>routebridge</b> :8084</span>
      </div>
    </div>`,
  script: `
      tl.fromTo(".mark", { opacity: 0, scale: 0.4, rotate: -8 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.5, ease: "expo.out" }, 0.1);
      tl.fromTo("#rev-word", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.55, ease: "power3.out" }, 0.45);
      show("#rev-eyebrow", 0.9, { y: 8 });
      landWords("#rev-title .w", 1.9);
      show("#rev-sub", 4.6, { y: 10 });
      gsap.utils.toArray("#rev-origins span").forEach((el, i) => pop(el, 7.0 + i * 0.22));
      tl.to(["#rev-title", "#rev-sub", "#rev-origins", "#rev-eyebrow", ".lockup"], { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.consent.start - L.reveal.start - 0.25)});`,
});

// ---- product scenes ---------------------------------------------------------------
// The real recording inside browser chrome, 1540 px wide on the dark ground; the camera
// pushes to the control the cursor uses. Targets are in footage pixels (1920x1080).
const FRAME = { left: 190, top: 70, width: 1540, bar: 44 };
const SCALE = FRAME.width / 1920;
const stagePoint = (fx, fy) => ({ x: FRAME.left + fx * SCALE, y: FRAME.top + FRAME.bar + fy * SCALE });
const pushTo = (fx, fy, s, at, dur = 0.5) => { const p = stagePoint(fx, fy); return `tl.to(cam, { scale: ${s}, x: ${r2(-(p.x - 960) * s)}, y: ${r2(-(p.y - 540) * s)}, duration: ${dur}, ease: "power2.inOut" }, ${at});`; };
const resetCam = (at) => `tl.set(cam, { scale: 1, x: 0, y: 0 }, ${at});`;

const PRODUCT_CSS = `
  .cam { position: absolute; z-index: 1; inset: 0; transform-origin: 50% 50%; }
  .frame { position: absolute; left: ${FRAME.left}px; top: ${FRAME.top}px; width: ${FRAME.width}px; border-radius: 16px; overflow: hidden; background: #1c1c1a; box-shadow: 0 30px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(234,231,220,0.14); }
  .bar { display: flex; align-items: center; gap: 10px; height: ${FRAME.bar}px; padding: 0 18px; background: #26262b; }
  .bar i { width: 11px; height: 11px; border-radius: 999px; background: rgba(234,231,220,0.3); }
  .bar .pill { margin: 0 auto; min-width: 520px; padding: 5px 18px; border-radius: 999px; background: rgba(0,0,0,0.35); color: rgba(234,231,220,0.75); font-family: "JetBrains Mono", monospace; font-size: 15px; text-align: center; }
  .screen { position: relative; width: ${FRAME.width}px; height: ${Math.round(1080 * SCALE)}px; overflow: hidden; background: #f6f3eb; }
  .screen video { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
  .chapter { position: absolute; z-index: 3; left: 160px; top: 20px; display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: ${MINT}; opacity: 0; }
  .chapter i { width: 9px; height: 9px; border-radius: 999px; background: ${CORAL}; }
`;

function product(id, duration, chapter, pill, videos, camScript, extra = "") {
  const vids = videos.map((v, i) => `<video id="${id}-v${i}" class="clip" src="${v.src}" data-start="${v.start}" data-duration="${v.duration}" data-media-start="${v.mediaStart}" data-playback-rate="${v.rate}" muted playsinline></video>`).join("\n          ");
  return scene(id, {
    css: PRODUCT_CSS,
    html: `
    <div class="chapter" id="${id}-chapter"><i></i>${chapter}</div>
    <div class="cam" id="${id}-cam">
      <div class="frame">
        <div class="bar"><i></i><i></i><i></i><span class="pill" id="${id}-pill" data-layout-ignore>${pill}</span></div>
        <div class="screen">
          ${vids}
        </div>
      </div>
    </div>${extra}`,
    script: `
      const cam = document.getElementById("${id}-cam");
      tl.fromTo("#${id}-chapter", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" }, 0.2);
      tl.fromTo(cam, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" }, 0);
${camScript}
      tl.to(cam, { opacity: 0, duration: 0.2, ease: "power2.in" }, ${r2(duration - 0.2)});`,
  });
}

const dur = (beat, next) => r2(L[next].start - L[beat].start);
const MAIN = "assets/footage/main.mp4";

const sConsent = product("s-consent", dur("consent", "discovery"), "01 · Consent before contact", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: dur("consent", "discovery"), mediaStart: 31.5, rate: 1.2 },
], `${pushTo(960, 540, 1.7, 2.9)}`);

const sDiscovery = product("s-discovery", dur("discovery", "trust"), "02 · Discovery · four independent origins", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: dur("discovery", "trust"), mediaStart: 114.6, rate: 0.88 },
], `${pushTo(1000, 520, 1.2, 1.0)}\n      ${pushTo(1000, 520, 1.0, 6.4)}`);

const sTrust = product("s-trust", dur("trust", "hostile"), "03 · Trust · signatures verified in the browser", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: dur("trust", "hostile"), mediaStart: 124.7, rate: 0.44 },
], `${pushTo(1100, 520, 1.45, 2.4)}`);

const sHostile = product("s-hostile", dur("hostile", "allocation"), "04 · The hostile supplier", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: dur("hostile", "allocation"), mediaStart: 129.4, rate: 0.83 },
], `${pushTo(605, 620, 1.7, 2.6)}`);

const sAllocation = product("s-allocation", dur("allocation", "approval"), "05 · Allocation · a deterministic engine", "localhost:8080 · ReliefMesh Command", [
  { src: MAIN, start: 0, duration: dur("allocation", "approval"), mediaStart: 140.3, rate: 0.43 },
], `${pushTo(1070, 400, 1.4, 1.0)}\n      ${pushTo(1070, 400, 1.0, 7.4)}`);

const approvalDur = dur("approval", "tracking");
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
], `${pushTo(960, 300, 1.3, 0.5, 0.4)}`);

// ---- stack and end card -----------------------------------------------------------

const stack = scene("stack", {
  css: `
    .plate { position: absolute; inset: 0; }
    .plate img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; opacity: 0.22; }
    .facts { position: absolute; left: 160px; top: 300px; display: grid; gap: 34px; }
    .fact { display: flex; align-items: baseline; gap: 26px; opacity: 0; }
    .fact b { font-size: 92px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${INK}; min-width: 330px; }
    .fact b.accent { color: ${CORAL}; }
    .fact span { font-size: 32px; font-weight: 500; color: rgba(234,231,220,0.8); }
    .fact span small { display: block; margin-top: 6px; font-size: 28px; color: ${SAND}; font-family: "JetBrains Mono", monospace; }
  `,
  allowOverlap: true,
  html: `
    <div id="stack-clip" class="clip" data-start="0" data-duration="${r2(L.claim.start - L.stack.start)}">
      <div class="plate"><img src="assets/stills/after.png" alt=""></div>
      <div class="eyebrow" id="stack-eyebrow"><i></i>Built on the Open Agentic Web MVP specification</div>
      <div class="facts">
        <div class="fact" id="f1"><b>1</b><span>official browser runtime, byte-identical in all five sites<small>npm run runtime:check</small></span></div>
        <div class="fact" id="f2"><b class="accent">12 / 12</b><span>call paths pass the official partner check<small>check_partner.mjs</small></span></div>
        <div class="fact" id="f3"><b>267</b><span>automated tests, 28 of them in a real browser across five origins<small>npm run compliance -- --e2e</small></span></div>
        <div class="fact" id="f4"><b>+1</b><span>Agent Interoperability Inspector, for any agentic website<small>tools/inspector</small></span></div>
      </div>
    </div>`,
  script: `
      show("#stack-eyebrow", 0.2, { y: 8 });
      [["#f1", 0.9], ["#f2", 4.0], ["#f3", 7.2], ["#f4", 10.4]].forEach(([sel, at]) => { tl.fromTo(sel, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, at); tl.fromTo(sel + " b", { scale: 0.7 }, { scale: 1, duration: 0.4, ease: "back.out(1.4)", transformOrigin: "left center" }, at); });
      tl.to([".facts", "#stack-eyebrow", ".plate"], { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.claim.start - L.stack.start - 0.25)});`,
});

const END_DUR = r2(TOTAL - L.claim.start);
const endcard = scene("endcard", {
  css: `
    .lockup { position: absolute; left: 50%; top: 300px; transform: translateX(-50%); display: flex; align-items: center; gap: 40px; }
    .mark { display: grid; place-items: center; width: 150px; height: 150px; border-radius: 36px; background: linear-gradient(135deg, #e98074, ${CORAL}); color: #fff; font-size: 56px; font-weight: 800; opacity: 0; box-shadow: 0 24px 60px rgba(232,90,79,0.35); }
    .wordmark { font-size: 128px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; clip-path: inset(0 100% 0 0); }
    .tag { position: absolute; left: 0; right: 0; top: 540px; text-align: center; font-size: 56px; font-weight: 700; letter-spacing: -0.02em; }
    .tag .w { display: inline-block; margin-right: 0.26em; opacity: 0; filter: blur(6px); }
    .tag .accent { color: ${CORAL}; }
    .url { position: absolute; left: 0; right: 0; top: 700px; text-align: center; font-family: "JetBrains Mono", monospace; font-size: 34px; color: ${MINT}; }
    .url span { opacity: 0; }
    .url small { display: block; margin-top: 16px; font-family: Inter, sans-serif; font-size: 28px; color: ${SAND}; opacity: 0; }
  `,
  html: `
    <div id="end-clip" class="clip" data-start="0" data-duration="${END_DUR}">
      <div class="lockup">${MARK}<div class="wordmark" id="end-word">ReliefMesh</div></div>
      <div class="tag" id="end-tag">${words("When disaster strikes, agents coordinate before humans have to.", ["before", "humans"])}</div>
      <div class="url" id="end-url">${"github.com/sanjaysaini383/open_agent".split("").map((c) => `<span>${c}</span>`).join("")}<small>Open Agentic Web Challenge · all incident and partner data is simulated; the cross-origin calls are real</small></div>
    </div>`,
  script: `
      tl.fromTo(".mark", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.45, ease: "expo.out" }, 0.1);
      tl.fromTo("#end-word", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.55, ease: "power3.out" }, 0.4);
      landWords("#end-tag .w", 1.2, 0.08);
      gsap.utils.toArray("#end-url span").forEach((el, i) => tl.set(el, { opacity: 1 }, 1.4 + i * 0.03));
      tl.fromTo("#end-url small", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 2.8);`,
});

// ---- captions ----------------------------------------------------------------------
const allWords = meta.lines.flatMap((line) => line.words.map((w) => ({ text: w.text, start: r2(w.start), end: r2(w.end) })));
const captions = `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: visible; pointer-events: none; font-family: Inter, sans-serif; }
    .cg { position: absolute; left: 0; right: 0; bottom: 84px; display: flex; justify-content: center; opacity: 0; }
    .cp { padding: 14px 34px 16px; border-radius: 18px; background: rgba(231, 229, 231, 0.96); box-shadow: 0 6px 24px rgba(0,0,0,0.22); text-align: center; white-space: nowrap; }
    .cw { display: inline-block; margin: 0 7px; font-size: 44px; font-weight: 700; line-height: 1.2; color: #767676; }
  </style>
  <div id="root" data-composition-id="captions" data-width="1920" data-height="1080" data-layout-allow-caption-zone>
    <div id="cap-stage" class="clip" data-start="0" data-duration="${TOTAL}"></div>
  </div>
  <script>
    (function () {
      const WORDS = ${JSON.stringify(allWords)};
      const MAX = 4, PAUSE = 0.32, TAIL = 0.28;
      const groups = []; let current = [];
      WORDS.forEach((w, i) => { current.push(w); const next = WORDS[i + 1]; const end = /[.,:;!?]$/.test(w.text); const pause = next ? next.start - w.end >= PAUSE : true; if (current.length >= MAX || end || pause || !next) { groups.push(current); current = []; } });
      const stage = document.getElementById("cap-stage");
      const tl = gsap.timeline({ paused: true });
      let prevEnd = 0;
      groups.forEach((g, gi) => {
        const el = document.createElement("div"); el.className = "cg"; el.id = "cg" + gi;
        const pill = document.createElement("div"); pill.className = "cp";
        g.forEach((w, wi) => { const s = document.createElement("span"); s.className = "cw"; s.id = "cw" + gi + "-" + wi; s.textContent = w.text; pill.appendChild(s); });
        el.appendChild(pill); stage.appendChild(el);
        const start = Math.max(0.1, g[0].start - 0.05, prevEnd + 0.02);
        const next = groups[gi + 1];
        const end = Math.max(start + 0.35, next ? Math.min(next[0].start - 0.05, g[g.length - 1].end + TAIL) : g[g.length - 1].end + TAIL);
        prevEnd = end;
        tl.set(el, { opacity: 1 }, start);
        g.forEach((w, wi) => { const s = "#cw" + gi + "-" + wi; tl.set(s, { color: wi === 0 ? "#1c1e1d" : "#767676" }, start); if (wi > 0) tl.to(s, { color: "#1c1e1d", duration: 0.08, ease: "none" }, Math.max(start, w.start - 0.04)); });
        tl.to(el, { opacity: 0, duration: 0.1, ease: "power2.in" }, end - 0.1);
        tl.set(el, { opacity: 0, visibility: "hidden" }, end);
      });
      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`;

// ---- the root ------------------------------------------------------------------------
const hosts = [
  ["hook", 0, L.tension.start], ["tension", L.tension.start, L.reveal.start], ["reveal", L.reveal.start, L.consent.start],
  ["s-consent", L.consent.start, L.discovery.start], ["s-discovery", L.discovery.start, L.trust.start], ["s-trust", L.trust.start, L.hostile.start],
  ["s-hostile", L.hostile.start, L.allocation.start], ["s-allocation", L.allocation.start, L.approval.start],
  ["s-approval", L.approval.start, L.approval.start + A1], ["s-prompt", L.approval.start + A1, L.approval.start + A1 + A2], ["s-window", L.approval.start + A1 + A2, L.tracking.start],
  ["s-tracking", L.tracking.start, L.tracking.start + T1], ["s-audit", L.tracking.start + T1, L.stack.start], ["stack", L.stack.start, L.claim.start], ["endcard", L.claim.start, TOTAL],
].map(([id, start, end], index) => `    <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${r2(start)}" data-duration="${r2(end - start)}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index: ${index + 1}"></div>`).join("\n");

// Sound: narration, then effects where the picture acts (sound.md: each with a cause).
const S = { whoosh: ".media/audio/sfx/sfx_003.mp3", glitch: ".media/audio/sfx/sfx_005.mp3", click: ".media/audio/sfx/sfx_004.mp3", pop: ".media/audio/sfx/sfx_006.mp3", riser: ".media/audio/sfx/sfx_002.mp3" };
const SD = { whoosh: 0.6, glitch: 1.6, click: 0.4, pop: 0.7, riser: 10.03 };
const t = (beat, offset) => r2(L[beat].start + offset);
const sfx = [
  ["pop", 0.5, 0.45], ["pop", t("hook", 1.5), 0.5],
  ["whoosh", t("tension", 0), 0.5], ["whoosh", t("reveal", 0), 0.55], ["pop", t("reveal", 0.12), 0.45],
  ["glitch", t("consent", 0), 0.4], ["click", t("consent", 1.54), 0.6], ["click", t("consent", 9.73), 0.6],
  ["whoosh", t("discovery", 0), 0.45],
  ["glitch", t("trust", 0), 0.4], ["pop", t("trust", 7.3), 0.45],
  ["whoosh", t("hostile", 0), 0.5], ["pop", t("hostile", 3.0), 0.5],
  ["glitch", t("allocation", 0), 0.4],
  ["riser", r2(L.approval.start - 10.03), 0.5], ["whoosh", t("approval", 0), 0.6], ["click", t("approval", 1.29), 0.6], ["click", t("approval", 7.08), 0.6], ["glitch", t("approval", 9.6), 0.4], ["pop", t("approval", 10.4), 0.45],
  ["whoosh", t("tracking", 0), 0.5], ["click", t("tracking", 0.88), 0.55], ["click", t("tracking", 3.22), 0.55], ["click", t("tracking", 5.68), 0.55], ["pop", t("tracking", 6.2), 0.45],
  ["whoosh", t("stack", 0), 0.5], ["pop", t("stack", 0.95), 0.45], ["pop", t("stack", 4.05), 0.45], ["pop", t("stack", 7.25), 0.45], ["pop", t("stack", 10.45), 0.45],
  ["whoosh", t("claim", 0), 0.6], ["pop", t("claim", 0.15), 0.5],
].map(([name, at, volume], index) => `    <audio id="sfx-${index}-${name}" class="clip" src="${S[name]}" data-start="${at}" data-duration="${SD[name]}" data-volume="${volume}" data-track-index="${({ whoosh: 4, glitch: 4, click: 5, pop: 6, riser: 7 })[name]}"></audio>`).join("\n");

const index = `<!doctype html>
<html lang="en" data-composition-variables='[{"id":"repo","type":"string","label":"Repository","default":"github.com/sanjaysaini383/open_agent"}]'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>ReliefMesh demo film</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${GROUND}; }
      #root { position: relative; width: 1920px; height: 1080px; background: ${GROUND}; }
    </style>
  </head>
  <body>
    <!-- ReliefMesh demo film: hook → old way → reveal → seven chapters of the real recording → stack → claim. Timed to the narration (script/voice-meta.json). Regenerate with: node script/build.mjs -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080" data-motion-blur="on">
${hosts}
    <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${TOTAL}" data-track-index="2" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index: 20"></div>
    <audio id="narration" class="clip" src="assets/voice/narration.wav" data-start="0" data-volume="1" data-track-index="3"></audio>
${sfx}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

await mkdir("compositions", { recursive: true });
const files = { hook, tension, reveal, "s-consent": sConsent, "s-discovery": sDiscovery, "s-trust": sTrust, "s-hostile": sHostile, "s-allocation": sAllocation, "s-approval": sApproval, "s-prompt": sPrompt, "s-window": sWindow, "s-tracking": sTracking, "s-audit": sAudit, stack, endcard, captions };
for (const [name, html] of Object.entries(files)) await writeFile(`compositions/${name}.html`, html);
await writeFile("index.html", index);
console.log(`wrote index.html (${TOTAL}s) and ${Object.keys(files).length} scenes; ${allWords.length} caption words`);
