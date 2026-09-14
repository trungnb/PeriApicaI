# PeriApicaI — Project Agent Instructions

Follow the shared coding core:
`/Users/trungnguyen/.ai-agent/CORE.md`

## Project Overview
PeriApicaI is an experimental AI web application (React 19, TypeScript, Vite, Express) for dental periapical lesion segmentation and educational CBCT analysis.

## Engineering Protocols
- Follow the global Ponytail laziness ladder (prefer minimal changes; YAGNI).
- Follow Caveman communication register (high density, zero fluff).
- Experimental prototype: not approved for clinical diagnostic use.

## Project Verification Gate
Before declaring completion on any change, verify:
```bash
npm run lint   # tsc --noEmit
npm run build  # Vite + Esbuild bundle check
npm test -- --silent
```
