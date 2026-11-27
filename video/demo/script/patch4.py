p = "script/build.mjs"
s = open(p, encoding="utf8").read()
def rep(a, b, count=1):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, count)
# Seams: the title leaves right up to the cut and the product arrives in 0.3 s, so the dip is one or two frames, not six.
rep('tl.fromTo(cam, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" }, 0);', 'tl.fromTo(cam, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" }, 0);')
rep('tl.to(cam, { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(duration - 0.26)});', 'tl.to(cam, { opacity: 0, duration: 0.2, ease: "power2.in" }, ${r2(duration - 0.2)});')
s = s.replace('{ opacity: 0, duration: 0.3, ease: "power2.in" }, ${r2(L.tension.start - 0.4)});', '{ opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.tension.start - 0.25)});')
s = s.replace('{ opacity: 0, duration: 0.3, ease: "power2.in" }, ${r2(L.reveal.start - L.tension.start - 0.4)});', '{ opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.reveal.start - L.tension.start - 0.25)});')
s = s.replace('{ opacity: 0, duration: 0.3, ease: "power2.in" }, ${r2(L.consent.start - L.reveal.start - 0.4)});', '{ opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.consent.start - L.reveal.start - 0.25)});')
s = s.replace('{ opacity: 0, duration: 0.3, ease: "power2.in" }, ${r2(L.claim.start - L.stack.start - 0.4)});', '{ opacity: 0, duration: 0.25, ease: "power2.in" }, ${r2(L.claim.start - L.stack.start - 0.25)});')
open(p, "w", encoding="utf8", newline="\n").write(s)
print("patched")
