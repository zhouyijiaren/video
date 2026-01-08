/*
 * WebRTC adapter interface aligned to the existing RtcEngine usage in this app.
 * Web-only: mirror methods/events/properties the UI already depends on.
 */

export type Uid = number;

export type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

export type DeviceInfo = MediaDeviceInfo;

export type VideoProfilePreset =
  | '120p_1'
  | '120p_3'
  | '180p_1'
  | '180p_3'
  | '180p_4'
  | '240p_1'
  | '240p_3'
  | '240p_4'
  | '360p_1'
  | '360p_3'
  | '360p_4'
  | '360p_6'
  | '360p_7'
  | '360p_8'
  | '360p_9'
  | '360p_10'
  | '360p_11'
  | '480p_1'
  | '480p_2'
  | '480p_3'
  | '480p_4'
  | '480p_6'
  | '480p_8'
  | '480p_9'
  | '480p_10'
  | '720p_1'
  | '720p_2'
  | '720p_3'
  | '720p_5'
  | '720p_6';

export type ScreenShareProfilePreset =
  | '480p_1'
  | '480p_2'
  | '480p_3'
  | '720p'
  | '720p_1'
  | '720p_2'
  | '720p_3'
  | '1080p'
  | '1080p_1'
  | '1080p_2'
  | '1080p_3';

export interface VideoEncoderConfiguration {
  bitrateMax?: number;
  bitrateMin?: number;
  frameRate?: number | {exact?: number; ideal?: number; max?: number; min?: number};
  height?: number | {exact?: number; ideal?: number; max?: number; min?: number};
  width?: number | {exact?: number; ideal?: number; max?: number; min?: number};
}

export interface RemoteVideoStats {
  uid: Uid;
  bitrate?: number;
  packetLossRate?: number;
  frameRate?: number;
  width?: number;
  height?: number;
}

export interface UsersVolumeLevel {
  uid: Uid;
  level: number; // 0..1
}

export type RtcEventName =
  | 'onJoinChannelSuccess'
  | 'onLeaveChannel'
  | 'onUserJoined'
  | 'onUserOffline'
  | 'onRemoteAudioStateChanged'
  | 'onRemoteVideoStateChanged'
  | 'onNetworkQuality'
  | 'onRemoteVideoStats'
  | 'onStreamMessage'
  | 'onScreenshareStopped'
  | 'onError';

export type RtcEventHandler = (...args: any[]) => void;

export interface RtcLocalStream {
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
}

export interface RtcEngineLike {
  // lifecycle
  initialize(config: {appId: string; areaCode?: number}): void;
  release(): void;

  // channel / role / config
  setChannelProfile(profile: number): Promise<void>;
  setClientRole(role: number): Promise<void>;
  enableAudioVolumeIndication(
    interval: number,
    smooth: number,
    reportVad: boolean,
  ): Promise<void>;
  enableDualStreamMode(mode: number): Promise<void>;

  // local media
  enableVideo(): Promise<void>;
  enableAudio(): Promise<void>;
  muteLocalAudioStream(muted: boolean): Promise<void>;
  muteLocalVideoStream(muted: boolean): Promise<void>;
  enableLocalAudio(enabled: boolean): Promise<void>;
  enableLocalVideo(enabled: boolean): Promise<void>;

  // remote media
  muteRemoteAudioStream(uid: Uid, muted: boolean): Promise<void>;
  muteRemoteVideoStream(uid: Uid, muted: boolean): Promise<void>;

  // devices
  getDevices(callback: (devices: DeviceInfo[]) => void): Promise<void>;
  changeMic(
    deviceId: string,
    onSuccess: () => void,
    onError: (err: any) => void,
  ): void;
  changeCamera(
    deviceId: string,
    onSuccess: () => void,
    onError: (err: any) => void,
  ): void;
  changeSpeaker(
    deviceId: string,
    onSuccess: () => void,
    onError: (err: any) => void,
  ): void;

  // video quality
  setVideoProfile(
    profile: VideoProfilePreset | VideoEncoderConfiguration,
  ): Promise<void>;
  setScreenShareProfile(
    profile: ScreenShareProfilePreset | VideoEncoderConfiguration,
  ): Promise<void>;

  // screenshare
  startScreenshare(
    screenShareToken?: string,
    channel?: string,
    _unused?: any,
    screenShareUid?: Uid,
    appId?: string,
    rtcInstance?: unknown,
    encryption?: unknown,
    config?: {encoderConfig?: string; optimizationMode?: string},
  ): Promise<void>;

  // stats
  getRemoteVideoStats(uid: Uid): RemoteVideoStats;
  getUsersVolumeLevel(): UsersVolumeLevel[];

  // events
  addListener(event: RtcEventName, handler: RtcEventHandler): void;
  removeAllListeners(event: RtcEventName): void;

  // properties used by UI
  localStream: RtcLocalStream;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  speakerDeviceId?: string;
}
