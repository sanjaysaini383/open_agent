// Generates index.html and every scene in compositions/ from the shot list below and the
// narration timings in script/voice-meta.json (word-level, from script/tts_edge.py).
// Re-run after changing either:   node script/build.mjs
//
// Production standard (video/PRODUCTION.md): every title, tag and camera move is cued to
// a spoken word; scenes overlap by OVER seconds so each cut is a zoom-through, a push or
// an iris rather than a hard cut; the camera never sits still on a hold; the recording is
// shown with its own pixels (framing and motion only, no grading); music sits under the
// voice on an automation lane and swells only when the narration has ended.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const meta = JSON.parse(await readFile("script/voice-meta.json", "utf8"));
const L = Object.fromEntries(meta.lines.map((line) => [line.beat, line]));
const r2 = (value) => Math.round(value * 100) / 100;
const TAIL = 3.0; // end card after the last word (make-music.py uses the same)
const TOTAL = r2(meta.total + TAIL);
const OVER = 0.45; // transition overlap between consecutive scenes

// A spoken word's time, relative to the start of its line (nth occurrence, 0-based).
const wAt = (beat, text, nth = 0) => {
  const line = L[beat];
  const key = text.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  const hits = line.words.filter((w) => w.text.toLowerCase().replace(/[^a-z0-9'-]/g, "") === key);
  if (!hits[nth]) throw new Error(`word "${text}" (#${nth}) not in line ${line.id}`);
  return r2(hits[nth].start - line.start);
};

// ---- palette and type ------------------------------------------------------------
const GROUND = "#0b0f0e";
const INK = "#eae7dc";
const MINT = "#d1e8e2";
const CORAL = "#e85a4f";
const SAND = "#d8c3a5";

const BASE_CSS = `
  #root { position: absolute; inset: 0; overflow: hidden; background: transparent; color: ${INK}; font-family: Inter, sans-serif; }
  .clip { position: absolute; inset: 0; }
  .stage { position: absolute; inset: 0; transform-origin: 50% 50%; }
  .ground { position: absolute; inset: 0; background: ${GROUND}; }
  .grid { position: absolute; inset: -96px; background-image: radial-gradient(rgba(234,231,220,0.10) 1.6px, transparent 1.6px); background-size: 48px 48px; }
  .glow { position: absolute; width: 1400px; height: 1400px; border-radius: 50%; background: radial-gradient(circle, rgba(232,90,79,0.20), rgba(232,90,79,0) 62%); }
  .eyebrow { position: absolute; left: 160px; top: 110px; display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: ${MINT}; opacity: 0; }
  .eyebrow i { width: 10px; height: 10px; border-radius: 999px; background: ${CORAL}; }
  .title { position: absolute; left: 160px; width: 1600px; font-size: 84px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }
  .title .line { display: block; overflow: hidden; padding-bottom: 0.08em; margin-bottom: -0.08em; }
  .title .li { display: block; transform: translateY(110%); }
  .accent { color: ${CORAL}; }
  .sub { position: absolute; left: 160px; width: 1500px; font-size: 34px; font-weight: 500; line-height: 1.4; color: rgba(234,231,220,0.72); opacity: 0; }
  .mono { font-family: "JetBrains Mono", monospace; }
`;

const lines = (...rows) => rows.map((row) => `<span class="line"><span class="li">${row}</span></span>`).join("");

function scene(id, { dur, enter = "zoom", exit = "zoom", last = false, timed = true, css = "", html, script }) {
  const clipDur = r2(dur + (last ? 0 : OVER));
  // A scene whose <video> clips carry their own timing is not wrapped in a timed element.
  const open = timed ? `<div id="${id}-clip" class="clip" data-start="0" data-duration="${clipDur}">` : `<div id="${id}-clip" class="clip">`;
  const ENTER = {
    cut: "",
    zoom: `tl.fromTo(stage, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: ${OVER}, ease: "power3.out" }, 0);`,
    push: `tl.fromTo(stage, { opacity: 0, x: 160 }, { opacity: 1, x: 0, duration: ${OVER}, ease: "expo.out" }, 0);`,
    iris: `tl.fromTo(stage, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(120% at 50% 50%)", duration: ${r2(OVER + 0.2)}, ease: "power2.inOut" }, 0);`,
  }[enter];
  const EXIT = last ? "" : {
    zoom: `tl.to(stage, { opacity: 0, scale: 1.12, duration: ${OVER}, ease: "power2.in" }, ${dur});`,
    push: `tl.to(stage, { opacity: 0, x: -160, duration: ${OVER}, ease: "power2.in" }, ${dur});`,
    iris: `tl.to(stage, { opacity: 0, duration: 0.2, ease: "power1.in" }, ${r2(dur + OVER - 0.2)});`,
  }[exit];
  return `<template>
  <style>${BASE_CSS}${css}</style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-layout-allow-overlap>
    ${open}
      <div class="stage" id="${id}-stage">
        <div class="ground" data-layout-ignore></div>
${html}
      </div>
    </div>
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      const stage = document.getElementById("${id}-stage");
      const rise = (selector, at, step = 0.12) => gsap.utils.toArray(selector).forEach((el, i) => tl.to(el, { y: "0%", duration: 0.7, ease: "power4.out" }, at + i * step));
      const sink = (selector, at, step = 0.05) => gsap.utils.toArray(selector).forEach((el, i) => tl.to(el, { y: "-110%", duration: 0.4, ease: "power3.in" }, at + i * step));
      const show = (selector, at, from = {}) => tl.fromTo(selector, { opacity: 0, ...from }, { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.45, ease: "power3.out" }, at);
      const pop = (selector, at) => tl.fromTo(selector, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.38, ease: "back.out(1.6)" }, at);
      const count = (selector, to, at, duration, format) => { const el = document.querySelector(selector); const o = { v: 0 }; tl.to(o, { v: to, duration, ease: "power3.out", onUpdate: () => { el.textContent = format(o.v); } }, at); };
      const drift = (selector, dur, dx = -48, dy = 0) => tl.fromTo(selector, { x: 0, y: 0 }, { x: dx, y: dy, duration: dur, ease: "none" }, 0);
      ${ENTER}
${script}
      ${EXIT}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}

// ---- the recording in a browser frame ---------------------------------------------
// Targets are in footage pixels (1920x1080); the camera is a wrapper the frame sits in.
const FRAME = { left: 190, top: 70, width: 1540, bar: 44 };
const SCALE = FRAME.width / 1920;
const stagePoint = (fx, fy) => ({ x: FRAME.left + fx * SCALE, y: FRAME.top + FRAME.bar + fy * SCALE });
const camVals = (fx, fy, s) => { const p = stagePoint(fx, fy); return { s, x: r2(-(p.x - 960) * s), y: r2(-(p.y - 540) * s) }; };

// A camera path: each key pushes to a point at a scale; between keys the camera keeps
// creeping 3.5% further in (never a static hold).
function camPath(keys, total) {
  let out = "";
  keys.forEach((k, i) => {
    const v = camVals(k.fx, k.fy, k.s);
    const d = k.dur ?? 0.9;
    out += d === 0
      ? `      tl.set(cam, { scale: ${v.s}, x: ${v.x}, y: ${v.y} }, ${k.at});\n`
      : `      tl.to(cam, { scale: ${v.s}, x: ${v.x}, y: ${v.y}, duration: ${d}, ease: "${k.ease ?? "power2.inOut"}" }, ${k.at});\n`;
    const next = keys[i + 1];
    const holdStart = r2(k.at + d), holdEnd = r2(next ? next.at : total);
    if (holdEnd - holdStart > 0.4) {
      const f = k.drift ?? 1.035;
      out += `      tl.to(cam, { scale: ${r2(v.s * f)}, x: ${r2(v.x * f)}, y: ${r2(v.y * f)}, duration: ${r2(holdEnd - holdStart)}, ease: "none" }, ${holdStart});\n`;
    }
  });
  return out;
}

const PRODUCT_CSS = `
  .cam { position: absolute; z-index: 1; inset: 0; transform-origin: 50% 50%; }
  .frame { position: absolute; left: ${FRAME.left}px; top: ${FRAME.top}px; width: ${FRAME.width}px; border-radius: 16px; overflow: hidden; background: #1c1c1a; box-shadow: 0 30px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(234,231,220,0.14); }
  .bar { display: flex; align-items: center; gap: 10px; height: ${FRAME.bar}px; padding: 0 18px; background: #26262b; }
  .bar i { width: 11px; height: 11px; border-radius: 999px; background: rgba(234,231,220,0.3); }
  .bar .pill { margin: 0 auto; min-width: 520px; padding: 5px 18px; border-radius: 999px; background: rgba(0,0,0,0.35); color: rgba(234,231,220,0.75); font-family: "JetBrains Mono", monospace; font-size: 15px; text-align: center; }
  .screen { position: relative; width: ${FRAME.width}px; height: ${Math.round(1080 * SCALE)}px; overflow: hidden; background: #f6f3eb; }
  .screen video { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
  .chapter { position: absolute; z-index: 3; left: 190px; top: 12px; display: flex; align-items: center; gap: 14px; padding: 7px 20px 7px 16px; border-radius: 999px; background: rgba(11,15,14,0.9); border: 1px solid rgba(209,232,226,0.2); font-size: 28px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: ${MINT}; opacity: 0; }
  .chapter i { width: 9px; height: 9px; border-radius: 999px; background: ${CORAL}; }
  .chapter u { text-decoration: none; color: rgba(209,232,226,0.55); }
  .tags { position: absolute; z-index: 3; right: 190px; top: 12px; display: flex; gap: 12px; }
  .tag { display: flex; align-items: center; gap: 10px; opacity: 0; padding: 7px 18px; border-radius: 999px; background: rgba(11,15,14,0.9); border: 1px solid rgba(209,232,226,0.35); color: ${MINT}; font-size: 28px; font-weight: 600; white-space: nowrap; }
  .tag i { width: 10px; height: 10px; border-radius: 999px; background: ${MINT}; }
  .tag.warn { border-color: rgba(232,90,79,0.7); color: #ffb9b2; }
  .tag.warn i { background: ${CORAL}; }
`;

function product(id, { dur, chapter, pill, videos, cam, tags = [], enter, exit, css = "", html = "", script = "", last = false }) {
  const clipDur = r2(dur + (last ? 0 : OVER));
  const vids = videos.map((v, i) => `<video id="${id}-v${i}" class="clip" src="${v.src}" data-start="${v.start ?? 0}" data-duration="${v.duration ?? clipDur}" data-media-start="${v.mediaStart}" data-playback-rate="${v.rate ?? 1}" muted playsinline></video>`).join("\n          ");
  const tagHtml = tags.map((t, i) => `<span class="tag${t.warn ? " warn" : ""}" id="${id}-t${i}"><i></i>${t.text}</span>`).join("");
  const tagScript = tags.map((t, i) => `      pop("#${id}-t${i}", ${t.at});`).join("\n");
  return scene(id, {
    dur, enter, exit, last, timed: false,
    css: PRODUCT_CSS + css,
    html: `
    <div class="cam" id="${id}-cam">
      <div class="frame">
        <div class="bar"><i></i><i></i><i></i><span class="pill" id="${id}-pill" data-layout-ignore>${pill}</span></div>
        <div class="screen">
          ${vids}
        </div>
      </div>
    </div>
    ${chapter ? `<div class="chapter" id="${id}-chapter"><i></i>${chapter}</div>` : ""}
    <div class="tags" id="${id}-tags">${tagHtml}</div>${html}`,
    script: `
      const cam = document.getElementById("${id}-cam");
      ${chapter ? `tl.fromTo("#${id}-chapter", { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, 0.25);` : ""}
${camPath(cam, clipDur)}
${tagScript}
${script}`,
  });
}

const MAIN = "assets/footage/main.mp4";
const CMD = "localhost:8080 · ReliefMesh Command";
const dur = (beat, next) => r2(L[next].start - L[beat].start);

// ---- 1. hook: inside the real map, pulling out to the dashboard ------------------------
const hookDur = r2(L.tension.start);
const hook = product("hook", {
  dur: hookDur, enter: "cut", exit: "push", chapter: null, pill: CMD,
  videos: [{ src: MAIN, mediaStart: 5.0, rate: 1 }],
  cam: [
    { fx: 768, fy: 860, s: 3.0, at: 0, dur: 0 },
    { fx: 900, fy: 700, s: 1.35, at: 0.35, dur: r2(hookDur - 0.2), ease: "power2.inOut" },
  ],
  css: `
    .scrim { position: absolute; z-index: 2; inset: 0; background: linear-gradient(100deg, rgba(11,15,14,0.96) 0%, rgba(11,15,14,0.88) 34%, rgba(11,15,14,0.0) 64%); }
    .ring { position: absolute; left: ${r2(768 * SCALE)}px; top: ${r2(860 * SCALE)}px; width: 160px; height: 160px; margin: -80px 0 0 -80px; border: 3px solid ${CORAL}; border-radius: 50%; opacity: 0; }
    .num { position: absolute; z-index: 3; left: 160px; top: 300px; font-size: 190px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: ${INK}; opacity: 0; }
    .num b { color: ${CORAL}; font-weight: 700; opacity: 0; }
    .hook-title { top: 540px; width: 1300px; z-index: 3; }
    .eyebrow { z-index: 3; }
  `,
  html: `
    <div class="scrim"></div>
    <div class="eyebrow" id="hook-eyebrow"><i></i>Malda district · flood · simulated scenario</div>
    <div class="num" id="hook-num"><span id="hook-count">0</span> <b id="hook-people">people</b></div>
    <div class="title hook-title" id="hook-title">${lines("need food, water", `and medicine <span class="accent">within 36 hours.</span>`)}</div>`,
  script: `
      const screen = document.querySelector("#hook-cam .screen");
      [0, 1, 2].forEach((i) => { const r = document.createElement("div"); r.className = "ring"; r.id = "hook-ring" + i; screen.appendChild(r); tl.fromTo(r, { opacity: 0.9, scale: 0.15 }, { opacity: 0, scale: 1.6, duration: 1.4, ease: "power2.out" }, 0.1 + i * 0.5); });
      show("#hook-eyebrow", ${wAt("hook", "flood")}, { y: 10 });
      tl.set("#hook-num", { opacity: 1 }, ${wAt("hook", "twelve")});
      count("#hook-count", 12000, ${wAt("hook", "twelve")}, 0.9, (v) => Math.round(v).toLocaleString("en-IN"));
      tl.fromTo("#hook-count", { scale: 0.9, transformOrigin: "left bottom" }, { scale: 1, duration: 0.6, ease: "power3.out" }, ${wAt("hook", "twelve")});
      show("#hook-people", ${wAt("hook", "people")}, { x: -20 });
      rise("#hook-title .li:nth-child(1)", ${wAt("hook", "need")});
      rise("#hook-title .line:nth-child(2) .li", ${wAt("hook", "medicine")});
      tl.fromTo("#hook-title .accent", { color: "${INK}" }, { color: "${CORAL}", duration: 0.3 }, ${wAt("hook", "thirty-six")});`,
});

// ---- 2. tension: four organisations, no shared platform ----------------------------------
const tension = scene("tension", {
  dur: dur("tension", "reveal"), enter: "push", exit: "iris",
  css: `
    .sites { position: absolute; left: 160px; top: 230px; display: flex; gap: 28px; align-items: center; }
    .site { opacity: 0; padding: 16px 22px; border: 1px solid rgba(234,231,220,0.22); border-radius: 12px; background: rgba(234,231,220,0.04); }
    .site b { display: block; font-size: 32px; font-weight: 700; }
    .site span { display: block; margin-top: 4px; font-size: 28px; color: ${SAND}; }
    .gap { width: 70px; height: 2px; background: repeating-linear-gradient(90deg, rgba(234,231,220,0.35) 0 8px, transparent 8px 16px); position: relative; opacity: 0; }
    .gap::after { content: "×"; position: absolute; left: 50%; top: -22px; transform: translateX(-50%); color: ${CORAL}; font-size: 30px; font-weight: 700; }
    .ten-title { top: 430px; }
  `,
  html: `
    <div class="grid" id="ten-grid"></div>
    <div class="glow" id="ten-glow" style="left: 1100px; top: -500px"></div>
    <div class="eyebrow" id="ten-eyebrow"><i></i>The first thirty-six hours</div>
    <div class="sites" id="ten-sites">
      <div class="site"><b>Shelters</b><span>ShelterConnect</span></div><div class="gap"></div>
      <div class="site"><b>Suppliers</b><span>AidSupply Network</span></div><div class="gap"></div>
      <div class="site"><b>Carriers</b><span>RouteBridge</span></div><div class="gap"></div>
      <div class="site"><b>Registry</b><span>TrustRegistry</span></div>
    </div>
    <div class="title ten-title" id="ten-title">${lines("The people who can help", `<span class="accent">don't share a platform.</span>`)}</div>
    <div class="sub" style="top: 700px" id="ten-sub">So coordination still happens by phone and spreadsheet.</div>`,
  script: `
      drift("#ten-grid", ${r2(dur("tension", "reveal") + OVER)});
      drift("#ten-glow", ${r2(dur("tension", "reveal") + OVER)}, -120, 60);
      show("#ten-eyebrow", 0.6, { y: 10 });
      [${["shelters", "suppliers", "carriers", "registry"].map((w) => wAt("tension", w)).join(", ")}].forEach((at, i) => pop(gsap.utils.toArray("#ten-sites .site")[i], at));
      gsap.utils.toArray("#ten-sites .gap").forEach((el, i) => tl.fromTo(el, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.3, ease: "power2.out" }, ${wAt("tension", "don't")} + i * 0.12));
      tl.fromTo("#ten-sites", { x: 0 }, { x: 6, duration: 0.05, repeat: 5, yoyo: true, ease: "none" }, ${wAt("tension", "share")});
      rise("#ten-title .li:nth-child(1)", ${wAt("tension", "that")});
      rise("#ten-title .line:nth-child(2) .li", ${wAt("tension", "don't")});
      show("#ten-sub", ${wAt("tension", "so")}, { y: 12 });`,
});

// ---- 3. reveal: the name, five sites, one protocol --------------------------------------
const MARK = (id, size) => `<span class="mark" id="${id}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.24)}px;font-size:${Math.round(size * 0.38)}px"><span class="mark-ring"></span><span>RM</span></span>`;
const LOCKUP_CSS = `
  .mark { position: relative; display: grid; place-items: center; background: linear-gradient(135deg, #e98074, ${CORAL}); color: #fff; font-weight: 800; letter-spacing: 0.02em; opacity: 0; box-shadow: 0 24px 60px rgba(232,90,79,0.35); }
  .mark-ring { position: absolute; inset: -4px; border-radius: inherit; border: 3px solid ${CORAL}; opacity: 0; }
  .wordmark { font-weight: 700; letter-spacing: -0.03em; line-height: 1; clip-path: inset(0 100% 0 0); }
  .wordmark small { display: block; margin-top: 6px; font-size: 22px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: ${MINT}; }
`;
const reveal = scene("reveal", {
  dur: dur("reveal", "consent"), enter: "iris", exit: "zoom",
  css: LOCKUP_CSS + `
    .lockup { position: absolute; left: 160px; top: 200px; display: flex; align-items: center; gap: 36px; }
    .wordmark { font-size: 112px; }
    .rev-title { top: 420px; }
    .origins { position: absolute; left: 160px; top: 790px; display: flex; flex-wrap: wrap; gap: 14px; }
    .origins span { opacity: 0; padding: 10px 18px; border-radius: 999px; border: 1px solid rgba(209,232,226,0.3); font-size: 28px; color: ${MINT}; }
    .origins span b { color: ${INK}; font-weight: 600; }
  `,
  html: `
    <div class="grid" id="rev-grid"></div>
    <div class="glow" id="rev-glow" style="left: -500px; top: 300px"></div>
    <div class="eyebrow" id="rev-eyebrow"><i></i>Open Agentic Web · official runtime, unmodified</div>
    <div class="lockup">${MARK("rev-mark", 128)}<div class="wordmark" id="rev-word">ReliefMesh<small>Command</small></div></div>
    <div class="title rev-title" id="rev-title">${lines("Five independent websites.", `One <span class="accent">open protocol.</span>`)}</div>
    <div class="sub" style="top: 660px" id="rev-sub">Each runs its own agents, on its own origin. Nobody has to adopt anyone's platform.</div>
    <div class="origins" id="rev-origins">
      <span><b>reliefmesh_command</b> :8080</span><span><b>shelterconnect</b> :8081</span><span><b>aidsupply</b> :8082</span><span><b>trustregistry</b> :8083</span><span><b>routebridge</b> :8084</span>
    </div>`,
  script: `
      drift("#rev-grid", ${r2(dur("reveal", "consent") + OVER)}, -60, -20);
      drift("#rev-glow", ${r2(dur("reveal", "consent") + OVER)}, 140, -40);
      tl.fromTo("#rev-mark", { opacity: 0, scale: 0.4, rotate: -10 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.55, ease: "expo.out" }, 0.1);
      tl.fromTo("#rev-mark .mark-ring", { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 1.9, duration: 0.9, ease: "power2.out" }, 0.25);
      tl.fromTo("#rev-word", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power3.out" }, 0.4);
      show("#rev-eyebrow", 1.0, { y: 10 });
      rise("#rev-title .li:nth-child(1)", ${wAt("reveal", "five")});
      rise("#rev-title .line:nth-child(2) .li", ${wAt("reveal", "open")});
      gsap.utils.toArray("#rev-origins span").forEach((el, i) => pop(el, ${wAt("reveal", "own", 1)} + i * 0.16));
      show("#rev-sub", ${wAt("reveal", "nobody")}, { y: 12 });`,
});

// ---- 4-10. chapters of the real recording ----------------------------------------------
const sConsent = product("s-consent", {
  dur: dur("consent", "discovery"), enter: "zoom", exit: "push",
  chapter: "<u>01</u> Consent", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 31.5, rate: 1.2 }],
  cam: [
    { fx: 960, fy: 540, s: 1.08, at: 0, dur: 0 },
    { fx: 960, fy: 540, s: 1.65, at: 2.3, dur: 1.0 },
    { fx: 960, fy: 560, s: 1.45, at: wAt("consent", "nothing"), dur: 1.0 },
  ],
  tags: [
    { at: wAt("consent", "origin"), text: "Origin named" },
    { at: wAt("consent", "why"), text: "Purpose stated" },
    { at: wAt("consent", "sent"), text: "Data listed" },
  ],
});

const sDiscovery = product("s-discovery", {
  dur: dur("discovery", "trust"), enter: "push", exit: "zoom",
  chapter: "<u>02</u> Discovery", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 114.6, rate: 1 }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 1000, fy: 520, s: 1.3, at: wAt("discovery", "find"), dur: 1.2 },
    { fx: 960, fy: 540, s: 1.08, at: wAt("discovery", "every"), dur: 1.0 },
  ],
  tags: [
    { at: wAt("discovery", "url"), text: "Found by URL" },
    { at: wAt("discovery", "origins"), text: "4 origins loaded" },
    { at: wAt("discovery", "request"), text: "Real cross-origin calls" },
  ],
});

const sTrust = product("s-trust", {
  dur: dur("trust", "hostile"), enter: "zoom", exit: "push",
  chapter: "<u>03</u> Trust", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 124.7, rate: 0.44 }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 1100, fy: 520, s: 1.45, at: wAt("trust", "verified"), dur: 1.1 },
    { fx: 1100, fy: 600, s: 1.6, at: wAt("trust", "hashed"), dur: 1.4 },
  ],
  tags: [
    { at: wAt("trust", "signature"), text: "ECDSA P-256 signature" },
    { at: wAt("trust", "hashed"), text: "SHA-256 digest" },
    { at: wAt("trust", "attested"), text: "Matches the registry" },
  ],
});

const sHostile = product("s-hostile", {
  dur: dur("hostile", "allocation"), enter: "push", exit: "zoom",
  chapter: "<u>04</u> Hostile supplier", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 129.4, rate: 1 }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 640, fy: 520, s: 1.8, at: wAt("hostile", "supplier"), dur: 1.0 },
    { fx: 580, fy: 630, s: 2.0, at: wAt("hostile", "below"), dur: 1.3 },
    { fx: 520, fy: 570, s: 2.2, at: wAt("hostile", "flagged"), dur: 0.8, ease: "power3.out" },
    { fx: 600, fy: 600, s: 1.6, at: wAt("hostile", "never"), dur: 1.0 },
  ],
  tags: [
    { at: wAt("hostile", "unverified"), text: "Unverified", warn: true },
    { at: wAt("hostile", "below"), text: "64% below median", warn: true },
    { at: wAt("hostile", "flagged"), text: "Excluded", warn: true },
  ],
});

const sAllocation = product("s-allocation", {
  dur: dur("allocation", "approval"), enter: "zoom", exit: "zoom",
  chapter: "<u>05</u> Allocation", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 140.3, rate: 0.43 }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 1070, fy: 400, s: 1.4, at: wAt("allocation", "engine"), dur: 1.1 },
    { fx: 960, fy: 540, s: 1.05, at: wAt("allocation", "model"), dur: 1.2 },
  ],
  tags: [
    { at: wAt("allocation", "budget"), text: "Within budget" },
    { at: wAt("allocation", "explains"), text: "A reason per line" },
    { at: wAt("allocation", "cannot"), text: "A model can't change a number" },
  ],
});

// Approval in three shots: the gate, then the supplier's window, then the carrier's.
const approvalDur = dur("approval", "tracking");
const A1 = wAt("approval", "confirmed");
const A2s = A1, A2 = r2(wAt("approval", "transport") - A1);
const A3s = r2(A1 + A2), A3 = r2(approvalDur - A3s);
const A1_RATE = r2((162.3 - 152.5) / (A1 + OVER));
const sApproval = product("s-approval", {
  dur: A1, enter: "zoom", exit: "iris",
  chapter: "<u>06</u> Approval", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 152.5, rate: A1_RATE }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 960, fy: 560, s: 1.25, at: 0.3, dur: 1.2 },
  ],
  tags: [
    { at: wAt("approval", "written"), text: "Nothing written yet" },
    { at: wAt("approval", "approves"), text: "A person approves" },
  ],
});
const sWindow = product("s-window", {
  dur: A2, enter: "iris", exit: "push",
  chapter: "<u>06</u> Supplier's window", pill: "localhost:8082 · AidSupply Network · its own window",
  videos: [{ src: "assets/footage/popup-2.mp4", mediaStart: 0.3, rate: 0.9 }],
  cam: [
    { fx: 960, fy: 330, s: 1.3, at: 0, dur: 0 },
    { fx: 960, fy: 170, s: 1.6, at: 1.9, dur: 1.0 }, // the "Reserved" receipt replaces the question at ~2.7 s
  ],
  tags: [
    { at: r2(wAt("approval", "window") - A2s), text: "The supplier's own window" },
    { at: r2(wAt("approval", "origin") - A2s), text: "localhost:8082" },
  ],
});
const sCarrier = product("s-carrier", {
  dur: A3, enter: "push", exit: "zoom",
  chapter: "<u>06</u> Carrier's window", pill: "localhost:8084 · RouteBridge · its own window",
  videos: [{ src: "assets/footage/popup-1.mp4", mediaStart: 0.3, rate: 1 }],
  cam: [
    { fx: 960, fy: 300, s: 1.3, at: 0, dur: 0 },
    { fx: 960, fy: 420, s: 1.4, at: 0.3, dur: 1.6, ease: "power1.inOut" },
  ],
  tags: [
    { at: 0.2, text: "The carrier's own window" },
    { at: r2(wAt("approval", "same") - A3s), text: "localhost:8084" },
  ],
});

// Tracking in two shots: the shipments reaching delivery, then the audit chain.
const trackingDur = dur("tracking", "stack");
const T1 = wAt("tracking", "lands");
const T2 = r2(trackingDur - T1);
const T1_RATE = r2((240.3 - 226.5) / (T1 + OVER));
const sTracking = product("s-tracking", {
  dur: T1, enter: "zoom", exit: "push",
  chapter: "<u>07</u> Tracking", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 226.5, rate: T1_RATE }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 1400, fy: 620, s: 1.4, at: 0.3, dur: 1.0 },
  ],
  tags: [
    { at: r2((233.55 - 226.5) / T1_RATE), text: "In transit" },
    { at: r2((239.71 - 226.5) / T1_RATE), text: "Delivered" },
  ],
});
const sAudit = product("s-audit", {
  dur: T2, enter: "push", exit: "zoom",
  chapter: "<u>07</u> Audit trail", pill: CMD,
  videos: [{ src: MAIN, mediaStart: 246.4, rate: 1 }],
  cam: [
    { fx: 960, fy: 540, s: 1.0, at: 0, dur: 0 },
    { fx: 960, fy: 300, s: 1.35, at: 0.2, dur: 0.9 },
  ],
  tags: [
    { at: r2(wAt("tracking", "hash-chained") - T1), text: "SHA-256 hash chain" },
  ],
});

// ---- 11. stack: the numbers, over the dashboard after the run ---------------------------
const stackDur = dur("stack", "claim");
const stack = scene("stack", {
  dur: stackDur, enter: "zoom", exit: "iris",
  css: `
    .plate { position: absolute; inset: 0; transform-origin: 50% 50%; }
    .plate img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; opacity: 0.2; }
    .facts { position: absolute; left: 160px; top: 290px; display: grid; gap: 34px; }
    .fact { display: flex; align-items: baseline; gap: 26px; opacity: 0; }
    .fact b { font-size: 92px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${INK}; min-width: 330px; }
    .fact b.accent { color: ${CORAL}; }
    .fact > span { font-size: 32px; font-weight: 500; color: rgba(234,231,220,0.8); }
    .fact > span small { display: block; margin-top: 6px; font-size: 28px; color: ${SAND}; font-family: "JetBrains Mono", monospace; }
  `,
  html: `
    <div class="plate" id="stack-plate"><img src="assets/stills/after.png" alt=""></div>
    <div class="eyebrow" id="stack-eyebrow"><i></i>Built on the Open Agentic Web MVP specification</div>
    <div class="facts">
      <div class="fact" id="f1"><b>1</b><span>official browser runtime, byte-identical in all five sites<small>npm run runtime:check</small></span></div>
      <div class="fact" id="f2"><b class="accent"><span id="f2n">0</span> / 12</b><span>call paths pass the official partner check<small>check_partner.mjs</small></span></div>
      <div class="fact" id="f3"><b id="f3n">0</b><span>automated tests, 28 of them in a real browser across five origins<small>npm run compliance -- --e2e</small></span></div>
      <div class="fact" id="f4"><b>+1</b><span>Agent Interoperability Inspector, for any agentic website<small>tools/inspector</small></span></div>
    </div>`,
  script: `
      tl.fromTo("#stack-plate", { scale: 1.0 }, { scale: 1.08, duration: ${r2(stackDur + OVER)}, ease: "none" }, 0);
      show("#stack-eyebrow", 0.3, { y: 10 });
      const fact = (sel, at) => { tl.fromTo(sel, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, at); tl.fromTo(sel + " b", { scale: 0.75 }, { scale: 1, duration: 0.45, ease: "back.out(1.4)", transformOrigin: "left center" }, at); };
      fact("#f1", ${wAt("stack", "runtime")});
      fact("#f2", ${wAt("stack", "twelve")}); count("#f2n", 12, ${wAt("stack", "twelve")}, 0.7, (v) => String(Math.round(v)));
      fact("#f3", ${wAt("stack", "two")}); count("#f3n", 267, ${wAt("stack", "two")}, 1.1, (v) => String(Math.round(v)));
      fact("#f4", ${wAt("stack", "inspector")});`,
});

// ---- 12. end card: the claim, word by word as it is spoken, then the mesh ---------------
const END_DUR = r2(TOTAL - L.claim.start);
const endcard = scene("endcard", {
  dur: END_DUR, enter: "iris", last: true,
  css: LOCKUP_CSS + `
    .lockup { position: absolute; left: 50%; top: 280px; transform: translateX(-50%); display: flex; align-items: center; gap: 40px; }
    .wordmark { font-size: 128px; }
    .mesh { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
    .mesh line { stroke: rgba(209,232,226,0.2); stroke-width: 2; }
    .mesh circle { fill: ${MINT}; opacity: 0; }
    .tag { position: absolute; left: 0; right: 0; top: 540px; text-align: center; font-size: 56px; font-weight: 700; letter-spacing: -0.02em; }
    .tag .w { display: inline-block; margin-right: 0.26em; opacity: 0; }
    .url { position: absolute; left: 0; right: 0; top: 700px; text-align: center; font-family: "JetBrains Mono", monospace; font-size: 34px; color: ${MINT}; }
    .url span { opacity: 0; }
    .url small { display: block; margin-top: 16px; font-family: Inter, sans-serif; font-size: 28px; color: ${SAND}; opacity: 0; }
  `,
  html: `
    <div class="grid" id="end-grid"></div>
    <svg class="mesh" id="end-mesh" viewBox="0 0 1920 1080">
      ${[[300, 200], [1620, 200], [240, 880], [1680, 880], [960, 980]].map(([x, y], i) => `<line id="end-l${i}" x1="960" y1="360" x2="${x}" y2="${y}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"></line><circle id="end-c${i}" cx="${x}" cy="${y}" r="9"></circle>`).join("")}
    </svg>
    <div class="lockup">${MARK("end-mark", 150)}<div class="wordmark" id="end-word">ReliefMesh</div></div>
    <div class="tag" id="end-tag">${L.claim.words.slice(1).map((w) => `<span class="w${/before|humans/.test(w.text) ? " accent" : ""}">${w.text}${w.text === "strikes" ? "," : ""}${w.text === "to" ? "." : ""}</span>`).join("")}</div>
    <div class="url" id="end-url">${"github.com/sanjaysaini383/open_agent".split("").map((c) => `<span>${c}</span>`).join("")}<small>Open Agentic Web Challenge · all incident and partner data is simulated; the cross-origin calls are real</small></div>`,
  script: `
      drift("#end-grid", ${END_DUR}, -40, -24);
      tl.fromTo("#end-mark", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, 0.1);
      tl.fromTo("#end-mark .mark-ring", { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 2.0, duration: 1.0, ease: "power2.out" }, 0.25);
      tl.fromTo("#end-word", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power3.out" }, 0.4);
      ${L.claim.words.slice(1).map((w, i) => `tl.fromTo("#end-tag .w:nth-child(${i + 1})", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, ${r2(w.start - L.claim.start)});`).join("\n      ")}
      gsap.utils.toArray("#end-url span").forEach((el, i) => tl.set(el, { opacity: 1 }, ${r2(L.claim.duration + 0.5)} + i * 0.025));
      tl.fromTo("#end-url small", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, ${r2(L.claim.duration + 1.6)});
      [0, 1, 2, 3, 4].forEach((i) => { tl.to("#end-l" + i, { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" }, ${r2(L.claim.duration + 0.9)} + i * 0.12); tl.to("#end-c" + i, { opacity: 1, duration: 0.25 }, ${r2(L.claim.duration + 1.5)} + i * 0.12); });`,
});

// ---- captions: karaoke on a light pill, four words a group --------------------------------
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
      const MAX = 4, PAUSE = 0.3, TAIL = 0.28;
      const groups = []; let current = [];
      WORDS.forEach((w, i) => { current.push(w); const next = WORDS[i + 1]; const pause = next ? next.start - w.end >= PAUSE : true; if (current.length >= MAX || pause || !next) { groups.push(current); current = []; } });
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

// ---- the root: scene hosts (overlapping by OVER), captions, narration, music, effects ----
const SCENES = [
  ["hook", 0, L.tension.start, "cut"], ["tension", L.tension.start, L.reveal.start, "push"], ["reveal", L.reveal.start, L.consent.start, "iris"],
  ["s-consent", L.consent.start, L.discovery.start, "zoom"], ["s-discovery", L.discovery.start, L.trust.start, "push"], ["s-trust", L.trust.start, L.hostile.start, "zoom"],
  ["s-hostile", L.hostile.start, L.allocation.start, "push"], ["s-allocation", L.allocation.start, L.approval.start, "zoom"],
  ["s-approval", L.approval.start, L.approval.start + A1, "zoom"], ["s-window", L.approval.start + A2s, L.approval.start + A3s, "iris"], ["s-carrier", L.approval.start + A3s, L.tracking.start, "push"],
  ["s-tracking", L.tracking.start, L.tracking.start + T1, "zoom"], ["s-audit", L.tracking.start + T1, L.stack.start, "push"], ["stack", L.stack.start, L.claim.start, "zoom"], ["endcard", L.claim.start, TOTAL, "iris"],
];
const hosts = SCENES.map(([id, start, end], index) => {
  const last = index === SCENES.length - 1;
  return `    <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${r2(start)}" data-duration="${r2(end - start + (last ? 0 : OVER))}" data-track-index="${1 + (index % 2)}" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index: ${index + 1}"></div>`;
}).join("\n");

// Effects (bundled library, CC0): one sound per visible cause, on its own lane.
const S = { whoosh: ".media/audio/sfx/sfx_003.mp3", glitch: ".media/audio/sfx/sfx_005.mp3", click: ".media/audio/sfx/sfx_004.mp3", pop: ".media/audio/sfx/sfx_006.mp3", riser: ".media/audio/sfx/sfx_002.mp3" };
const SD = { whoosh: 0.57, glitch: 1.0, click: 0.36, pop: 0.72, riser: 10.03 };
const t = (beat, offset) => r2(L[beat].start + offset);
const clicks = [
  ["consent", (33.35 - 31.5) / 1.2], ["consent", (43.18 - 31.5) / 1.2],
  ["discovery", 120.27 - 114.6],
  ["approval", (160.75 - 152.5) / A1_RATE],
  ["tracking", (227.7 - 226.5) / T1_RATE], ["tracking", (233.55 - 226.5) / T1_RATE], ["tracking", (239.71 - 226.5) / T1_RATE],
].map(([beat, offset]) => ["click", t(beat, offset), 0.55]);
const transitions = SCENES.slice(1).map(([, start, , enter]) => ({ push: ["whoosh", r2(start), 0.5], zoom: ["glitch", r2(start), 0.32], iris: ["whoosh", r2(start), 0.55] })[enter]);
const tagPops = [
  ...["hook"].flatMap(() => [["pop", t("hook", wAt("hook", "twelve")), 0.45], ["pop", t("hook", wAt("hook", "people")), 0.35]]),
  ...[["tension", ["shelters", "suppliers", "carriers", "registry"]], ["reveal", ["own"]], ["consent", ["origin", "why", "sent"]], ["discovery", ["url", "origins", "real"]], ["trust", ["signature", "hashed", "attested"]],
    ["hostile", ["unverified", "below", "flagged"]], ["allocation", ["budget", "explains", "cannot"]], ["approval", ["written", "approves", "window", "origin"]], ["tracking", ["hash-chained"]], ["stack", ["runtime", "twelve", "two", "inspector"]]]
    .map(([beat, ws]) => [beat, ws.map((w) => (beat === "discovery" && w === "real" ? "request" : w))])
    .flatMap(([beat, ws]) => ws.map((w) => ["pop", t(beat, wAt(beat, w, w === "own" ? 1 : 0)), 0.3])),
  ["pop", t("tracking", (233.55 - 226.5) / T1_RATE + 0.1), 0.3], ["pop", t("tracking", (239.71 - 226.5) / T1_RATE + 0.1), 0.3],
  ["pop", t("approval", A2s + 2.7), 0.4],
  ["pop", t("claim", 0.15), 0.45],
];
const sfxList = [
  ["whoosh", 0, 0.45],
  ...transitions, ...clicks, ...tagPops,
  ["riser", r2(L.approval.start - SD.riser), 0.45],
].sort((a, b) => a[1] - b[1]);
// One Studio lane per kind; a sound that would overlap the previous one of its kind takes
// the kind's second lane (the render mixes every audible clip whatever its lane).
const laneEnd = {};
const sfx = sfxList.map(([name, at, volume], index) => {
  const base = { whoosh: 4, glitch: 4, click: 5, pop: 6, riser: 7 }[name];
  const lane = (laneEnd[base] ?? -1) > at ? base + 10 : base;
  laneEnd[lane] = at + SD[name];
  return `    <audio id="sfx-${index}-${name}" class="clip" src="${S[name]}" data-start="${r2(at)}" data-duration="${SD[name]}" data-volume="${volume}" data-track-index="${lane}"></audio>`;
}).join("\n");

// Music: a licensed CC0 ambient loop (assets/music/CREDITS.md), level set once here, held
// 12 dB under the voice and allowed up only after the last word.
const narrationEnd = r2(L.claim.end);
const musicLane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0.85 }, { t: 1.4, v: 0.62 }, { t: narrationEnd, v: 0.62 }, { t: r2(narrationEnd + 1.2), v: 1 }] }] }).replace(/"/g, "&quot;");

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
    <!-- ReliefMesh demo film. Scenes overlap by ${OVER}s for the transitions. Timed to script/voice-meta.json. Regenerate with: node script/build.mjs -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080" data-motion-blur="on" data-layout-allow-overlap>
${hosts}
    <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${TOTAL}" data-track-index="3" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index: 40"></div>
    <audio id="narration" class="clip" src="assets/voice/narration.wav" data-start="0" data-volume="1" data-track-index="8"></audio>
    <audio id="music" class="clip" src="assets/music/bed.wav" data-start="0" data-duration="${TOTAL}" data-volume="0.3" data-fade-in="1.2" data-fade-out="2.6" data-track-index="9" data-automation="${musicLane}"></audio>
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
const files = { hook, tension, reveal, "s-consent": sConsent, "s-discovery": sDiscovery, "s-trust": sTrust, "s-hostile": sHostile, "s-allocation": sAllocation, "s-approval": sApproval, "s-window": sWindow, "s-carrier": sCarrier, "s-tracking": sTracking, "s-audit": sAudit, stack, endcard, captions };
for (const [name, html] of Object.entries(files)) await writeFile(`compositions/${name}.html`, html);
await writeFile("index.html", index);
console.log(`wrote index.html (${TOTAL}s) and ${Object.keys(files).length} scenes; ${allWords.length} caption words; approval shots ${A1}/${A2}/${A3}s, tracking ${T1}/${T2}s`);
