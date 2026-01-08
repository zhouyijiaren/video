# WebRTC Adapter Plan (Web Only)

Goal: Replace/extend the existing SDK-based RTC layer with a WebRTC adapter for web builds, while preserving the app's current RTC-facing API surface.

## Scope
- Web-only implementation.
- New folder contains all plan and implementation artifacts.
- Adapter should be compatible with existing call flows and event handlers.

## High-Level Steps
1) Inventory current RTC usage
   - Identify all calls to `useRtc`, `RtcEngineUnsafe`, and `SDKEvents`.
   - Produce a required API/behavior checklist.

2) Define adapter contract
   - Create TypeScript interfaces for engine, tracks, and event emitter.
   - Map required methods to WebRTC equivalents.

3) Implement WebRTC adapter
   - Manage local media (getUserMedia).
   - Manage peer connections and remote tracks.
   - Handle publish/unpublish, mute, screen share.
   - Emit SDK-like events for existing UI flows.

4) Wire adapter into app (web only)
   - Replace RTC engine creation or dependency injection point.
   - Keep native/mobile paths unchanged.

5) Validate
   - Manual join/leave, mute, camera, screen share.
   - Confirm remote user events and rendering.

## Notes
- This folder will also include implementation files and docs as we proceed.
