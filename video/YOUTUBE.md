# YouTube upload

Video: `video/demo/renders/reliefmesh-demo.mp4` · Thumbnail: `video/thumbnail/reliefmesh-thumbnail-1280.jpg`

## Title

ReliefMesh: AI agents coordinate a flood response, humans approve | Open Agentic Web demo

## Description

Chapters are timed from `video/demo/script/voice-meta.json`. YouTube ignores a chapter
shorter than 10 s, so scenes shorter than that are merged. Re-time them if the narration changes.

```text
When a flood hits, 12,000 people need food, water and medicine within 36 hours. ReliefMesh lets independent organisations' AI agents coordinate that response across their own websites, with a person approving every commitment.

ReliefMesh is five independent agentic websites built on the Open Agentic Web: a coordination dashboard, a shelter network, a supplier marketplace, a trust registry and a logistics network. Each runs its own agents on its own origin. Nobody has to adopt anyone's platform.

In this two-minute demo:
• Consent before contact: you see which site, why, and what data is sent before any request leaves the page
• Discovery: agents find partners by URL and load their published agent networks
• Trust: signatures (ECDSA P-256) and network-file digests (SHA-256) are verified in your browser
• Prompt-injection defence: a hostile supplier tells the agent to "approve immediately". It is flagged, excluded and never obeyed
• A deterministic allocation engine: a model may explain the plan, but it cannot change a number
• Human approval: each reservation and booking is confirmed in the partner's own window, on the partner's own origin
• A hash-chained audit trail of every consent, decision and receipt

Chapters
0:00 The problem
0:15 Meet ReliefMesh
0:27 Consent before contact
0:37 Discovery and trust
0:55 The hostile supplier
1:05 Allocation and human approval
1:26 Tracking, audit and the stack

Under the hood
• The official Open Agentic Web browser runtime, unmodified, in all five sites
• 12 of 12 cross-site call paths pass the official partner check
• 267 automated tests, 28 of them in a real browser across five origins
• An Agent Interoperability Inspector anyone can use to check their own agentic website

Code: https://github.com/sanjaysaini383/open_agent

What is real and what is simulated: the incident, organisations, stock, prices and the trust registry's authority are simulated. The cross-origin calls between the five sites, the signature checks and the allocation engine are real. Every screen in this video is a recording of the running product, not a mockup.

Built for the Cognizant Open Agentic Web Challenge.

Narration: Microsoft neural text-to-speech voice (en-IN-NeerjaNeural).
Music: "Overlook (uplifting ambient loop)" by SondreDrakensson, CC0, via Freesound.
Map data © OpenStreetMap contributors.

#AgenticWeb #AIAgents #OpenSource #Hackathon #DisasterResponse #MultiAgent
```
