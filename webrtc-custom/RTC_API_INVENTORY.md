# RTC API Inventory (Web)

This is a focused inventory of RTC API usage in the current web app. It defines the minimum surface a custom WebRTC adapter must provide to replace the current SDK-backed engine.

## Engine Creation / Lifecycle
- `createAgoraRtcEngine()` -> returns an engine instance used as `RtcEngineUnsafe` (web bridge).
  - Used by `video/agora-rn-uikit/src/Rtc/Create.tsx` to create and configure the engine.

- `initialize({ appId, areaCode? })`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`

- `release()`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`

## Channel / Role / Basic Config
- `setChannelProfile(profile)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `setClientRole(role)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `enableAudioVolumeIndication(interval, smooth, report_vad)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `enableDualStreamMode(mode)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`

## Local Media Control
- `enableVideo()`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `enableAudio()`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `muteLocalAudioStream(muted)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`, `video/src/utils/useMuteToggleLocal.ts`, `video/src/utils/useLocalAudio.ts`, `video/src/components/EventsConfigure.tsx`
- `muteLocalVideoStream(muted)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`, `video/src/utils/useMuteToggleLocal.ts`, `video/src/utils/useLocalVideo.ts`, `video/src/components/EventsConfigure.tsx`
- `enableLocalAudio(enabled)`
  - `video/src/utils/useMuteToggleLocal.ts`, `video/src/components/EventsConfigure.tsx`
- `enableLocalVideo(enabled)`
  - `video/src/utils/useMuteToggleLocal.ts`, `video/src/components/EventsConfigure.tsx`

## Remote Media Control
- `muteRemoteAudioStream(uid, muted)`
  - `video/agora-rn-uikit/src/Controls/Remote/RemoteAudioMute.tsx`
- `muteRemoteVideoStream(uid, muted)`
  - `video/agora-rn-uikit/src/Controls/Remote/RemoteVideoMute.tsx`

## Devices (Web)
- `getDevices(callback)`
  - `video/src/components/DeviceConfigure.tsx`
- `changeMic(deviceId, onSuccess, onError)`
  - `video/src/components/DeviceConfigure.tsx`
- `changeCamera(deviceId, onSuccess, onError)`
  - `video/src/components/DeviceConfigure.tsx`
- `changeSpeaker(deviceId, onSuccess, onError)`
  - `video/src/components/DeviceConfigure.tsx`

## Video Quality (Web)
- `setVideoProfile(profileOrConfig)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`, `video/src/app-state/useVideoQuality.tsx`
- `setScreenShareProfile(profileOrConfig)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`, `video/src/app-state/useVideoQuality.tsx`

## Screen Share (Web)
- `startScreenshare(...)`
  - `video/src/subComponents/screenshare/ScreenshareConfigure.tsx`
  - Used with full signature:
    - `startScreenshare(screenShareToken, channel, null, screenShareUid, appId, rtcInstance, encryption, config)`
  - Also called with no args to stop/toggle:
    - `video/src/subComponents/screenshare/ScreenshareConfigure.tsx` (kick screenshare)

## Stats / Diagnostics
- `getRemoteVideoStats(uid)`
  - `video/src/pages/video-call/VideoRenderer.tsx`
- `getUsersVolumeLevel()`
  - `video/src/utils/useFindActiveSpeaker.ts`

## Event Handling
- `addListener(eventName, callback)`
- `removeAllListeners(eventName)`

Events used (web):
- `onJoinChannelSuccess(connection?, elapsed)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onUserJoined(connection?, uid)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onUserOffline(connection?, uid)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onRemoteAudioStateChanged(connection?, uid, state, reason, elapsed)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onRemoteVideoStateChanged(connection?, uid, state, reason, elapsed)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onError(error)`
  - `video/agora-rn-uikit/src/Rtc/Create.tsx`
- `onNetworkQuality(uid, txQuality, rxQuality)`
  - `video/src/components/NetworkQualityContext.tsx`
- `onRemoteVideoStats(stats)`
  - `video/src/pages/video-call/VideoRenderer.tsx`
- `onStreamMessage(uid, payload)`
  - `video/src/utils/useSpeechToText.ts`, `video/src/subComponents/caption/Caption.tsx`, `video/src/subComponents/caption/Transcript.tsx`, `video/src/ai-agent/components/AgentControls/AgentContext.tsx`
- `onScreenshareStopped()`
  - `video/src/subComponents/screenshare/ScreenshareConfigure.tsx`

## Engine Properties Used (Web)
- `localStream.audio` / `localStream.video`
  - Used for device selection and noise suppression.
  - `video/src/components/DeviceConfigure.tsx`, `video/src/app-state/useNoiseSupression.tsx`
- `isAudioEnabled`, `isVideoEnabled`
  - `video/src/components/DeviceConfigure.tsx`
- `audioDeviceId`, `videoDeviceId`, `speakerDeviceId`
  - `video/src/components/DeviceConfigure.tsx`

## Notes / Risk Areas
- Noise suppression (`useNoiseSupression`) uses Agora-specific audio track APIs (`pipe`, `processorDestination`). A WebRTC adapter will need an equivalent pipeline or a no-op fallback.
- Screenshare API currently expects an Agora-style signature; the adapter should accept the same parameters to avoid touching call sites.
