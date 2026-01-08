# WebRTC Adapter (Web Only)

This folder contains a WebRTC adapter that mirrors the existing `RtcEngine` API used by the app, so we can swap the SDK-backed engine for a WebRTC implementation without changing call sites.

## Contents
- `PLAN.md`: Step-by-step plan.
- `RTC_API_INVENTORY.md`: Current RTC API usage.
- `rtc-engine-interface.ts`: TypeScript interface mirroring the app's RTC usage.

## Direction
- We will keep method names, event names, and property shapes consistent with the current `RtcEngine` usage.
- The adapter will be wired only for web builds; native paths remain unchanged.
