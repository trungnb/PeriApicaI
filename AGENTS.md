# PeriApicaI — Project Agent Instructions

Follow the shared coding core:
`/Users/trungnguyen/.ai-agent/CORE.md`

## Project Overview
PeriApicaI is an experimental React/TypeScript/Express prototype for AI-assisted review of dental periapical radiographs. It has two independent workflows: technical-quality assessment and candidate pathology localisation. It is not clinically validated and is not a medical device.

## Project-specific rules
- Prefer minimal changes and reuse existing components/utilities.
- Preserve the technical-quality and pathology workflows as independent modes.
- Keep clinical claims bounded to research/education use; do not imply validated diagnosis or treatment.
- Preserve server-side validation, provenance, human-review state, and credential isolation.

## Verification gate
Before declaring completion:
```bash
npm run lint
npm run build
npm test -- --silent
```
