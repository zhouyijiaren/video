'use strict';

const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');
const wrtc = require('wrtc');
const path = require('path');

const ReactNative106 = require(path.join(
  __dirname,
  'node_modules',
  'mediasoup-client',
  'lib',
  'handlers',
  'ReactNative106.js',
));

global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.MediaStream = wrtc.MediaStream;
global.MediaStreamTrack = wrtc.MediaStreamTrack;
global.navigator = {userAgent: 'node'};

if (!global.MediaStream.prototype.release) {
  global.MediaStream.prototype.release = function release() {};
}

const {RTCAudioSource, RTCVideoSource} = wrtc.nonstandard;

const SERVER_URL = process.env.SFU_URL || 'http://host.docker.internal:3001';
const ROOM_ID = process.env.SFU_ROOM || 'demo';
const CLIENTS = Number(process.env.SFU_CLIENTS || 2);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createSilentAudioTrack() {
  const source = new RTCAudioSource();
  const track = source.createTrack();
  const sampleRate = 48000;
  const frameSize = 480;
  const samples = new Int16Array(frameSize);

  const interval = setInterval(() => {
    source.onData({
      samples,
      sampleRate,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: samples.length,
    });
  }, 10);

  return {track, stop: () => clearInterval(interval)};
}

function createBlackVideoTrack() {
  const source = new RTCVideoSource();
  const track = source.createTrack();
  const width = 640;
  const height = 360;
  const frameSize = Math.floor(width * height * 1.5);
  const data = Buffer.alloc(frameSize);

  const interval = setInterval(() => {
    source.onFrame({width, height, data});
  }, 33);

  return {track, stop: () => clearInterval(interval)};
}

function request(socket, eventName, payload, responseEvent, matchFn) {
  return new Promise(resolve => {
    const handler = data => {
      if (matchFn && !matchFn(data)) return;
      socket.off(responseEvent, handler);
      resolve(data);
    };
    socket.on(responseEvent, handler);
    socket.emit(eventName, payload);
  });
}

class TestClient {
  constructor(name) {
    this.name = name;
    this.socket = null;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.audioProducer = null;
    this.videoProducer = null;
    this.consumers = new Map();
    this.stoppers = [];
  }

  async start() {
    this.socket = io(SERVER_URL, {transports: ['websocket']});

    const joined = await request(
      this.socket,
      'join',
      {roomId: ROOM_ID},
      'joined',
    );

    const handlerFactory = ReactNative106.ReactNative106.createFactory();
    this.device = new mediasoupClient.Device({handlerFactory});
    await this.device.load({routerRtpCapabilities: joined.rtpCapabilities});
    this.socket.emit('setRtpCapabilities', {rtpCapabilities: this.device.rtpCapabilities});

    this.sendTransport = await this.createTransport(false);
    this.recvTransport = await this.createTransport(true);

    this.socket.on('newProducer', async ({producerId, peerId}) => {
      if (peerId === this.socket.id) return;
      await this.consumeProducer(producerId, peerId);
    });

    for (const producer of joined.existingProducers) {
      if (producer.peerId === this.socket.id) continue;
      await this.consumeProducer(producer.producerId, producer.peerId);
    }

    const audio = createSilentAudioTrack();
    const video = createBlackVideoTrack();
    this.stoppers.push(audio.stop, video.stop);

    this.audioProducer = await this.sendTransport.produce({
      track: audio.track,
      appData: {type: 'audio', name: this.name},
    });

    this.videoProducer = await this.sendTransport.produce({
      track: video.track,
      appData: {type: 'video', name: this.name},
    });

    console.log(`[${this.name}] joined room ${ROOM_ID}`);
  }

  async createTransport(consumer) {
    const data = await request(
      this.socket,
      'createWebRtcTransport',
      {consumer},
      'transportCreated',
      resp => resp.consumer === !!consumer,
    );

    const transport = consumer
      ? this.device.createRecvTransport(data)
      : this.device.createSendTransport(data);

    transport.on('connect', ({dtlsParameters}, callback, errback) => {
      request(
        this.socket,
        'connectTransport',
        {transportId: transport.id, dtlsParameters},
        'transportConnected',
        resp => resp.transportId === transport.id,
      )
        .then(() => callback())
        .catch(errback);
    });

    if (!consumer) {
      transport.on('produce', async ({kind, rtpParameters, appData}, callback, errback) => {
        try {
          const data = await request(
            this.socket,
            'produce',
            {transportId: transport.id, kind, rtpParameters, appData},
            'produced',
          );
          callback({id: data.producerId});
        } catch (err) {
          errback(err);
        }
      });
    }

    return transport;
  }

  async consumeProducer(producerId, peerId) {
    const data = await request(
      this.socket,
      'consume',
      {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      },
      'consuming',
      resp => resp.producerId === producerId,
    );

    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    this.consumers.set(consumer.id, consumer);
    await request(
      this.socket,
      'resume',
      {consumerId: consumer.id},
      'resumed',
      resp => resp.consumerId === consumer.id,
    );

    console.log(`[${this.name}] consuming ${consumer.kind} from ${peerId}`);
  }

  async logConsumerStats() {
    let totalBytes = 0;
    let totalPackets = 0;
    for (const consumer of this.consumers.values()) {
      try {
        const stats = await consumer.getStats();
        for (const report of stats.values()) {
          if (typeof report.bytesReceived === 'number') {
            totalBytes += report.bytesReceived;
          }
          if (typeof report.packetsReceived === 'number') {
            totalPackets += report.packetsReceived;
          }
        }
      } catch (_) {}
    }
    console.log(
      `[${this.name}] stats consumers=${this.consumers.size} bytesReceived=${totalBytes} packetsReceived=${totalPackets}`,
    );

    const serverStats = await request(
      this.socket,
      'getStats',
      {},
      'stats',
    );
    console.log(
      `[${this.name}] server stats producer bytes=${serverStats.producer.bytesReceived} packets=${serverStats.producer.packetsReceived} ` +
        `consumer bytes=${serverStats.consumer.bytesSent} packets=${serverStats.consumer.packetsSent}`,
    );
  }

  async stop() {
    for (const consumer of this.consumers.values()) {
      try {
        consumer.close();
      } catch (_) {}
    }
    this.consumers.clear();

    if (this.audioProducer) this.audioProducer.close();
    if (this.videoProducer) this.videoProducer.close();

    if (this.sendTransport) this.sendTransport.close();
    if (this.recvTransport) this.recvTransport.close();

    for (const stop of this.stoppers) stop();

    if (this.socket) this.socket.disconnect();
  }
}

async function run() {
  console.log(`[test] connecting to ${SERVER_URL}, room ${ROOM_ID}`);
  const clients = [];

  for (let i = 0; i < CLIENTS; i += 1) {
    clients.push(new TestClient(`client-${i + 1}`));
  }

  for (const client of clients) {
    await client.start();
    await wait(300);
  }

  console.log('[test] running for 10 seconds...');
  await wait(2000);
  for (const client of clients) {
    await client.logConsumerStats();
  }
  await wait(8000);

  for (const client of clients) {
    await client.stop();
  }
  console.log('[test] done');
}

run().catch(err => {
  console.error('[test] failed', err);
  process.exit(1);
});
