'use strict';

module.exports = {
  http: {
    port: process.env.PORT ? Number(process.env.PORT) : 3001,
  },
  mediasoup: {
    worker: {
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.ANNOUNCED_IP || undefined,
        },
      ],
      enableUdp: process.env.MEDIASOUP_FORCE_TCP ? false : true,
      enableTcp: true,
      preferUdp: process.env.MEDIASOUP_FORCE_TCP ? false : true,
      initialAvailableOutgoingBitrate: 1000000,
      maxIncomingBitrate: 1500000,
    },
  },
};
