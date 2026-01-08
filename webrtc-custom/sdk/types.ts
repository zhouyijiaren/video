export type Uid = number;

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

export type RemoteVideoStats = {
  uid: Uid;
  bitrate?: number;
  packetLossRate?: number;
  frameRate?: number;
  width?: number;
  height?: number;
};

export type UsersVolumeLevel = {
  uid: Uid;
  level: number;
};

export type VideoEncoderConfiguration = {
  bitrateMax?: number;
  bitrateMin?: number;
  frameRate?: number | {exact?: number; ideal?: number; max?: number; min?: number};
  height?: number | {exact?: number; ideal?: number; max?: number; min?: number};
  width?: number | {exact?: number; ideal?: number; max?: number; min?: number};
};

export type JoinConfig = {
  uid?: Uid;
  screenShareUid?: Uid;
  roomId: string;
};
