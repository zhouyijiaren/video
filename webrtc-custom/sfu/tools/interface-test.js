'use strict';

const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');
const path = require('path');
const {FakeMediaStreamTrack} = require('fake-mediastreamtrack');

const FakeHandler = require(path.join(
  __dirname,
  '..',
  'node_modules',
  'mediasoup-client',
  'lib',
  'handlers',
  'FakeHandler.js',
));

const fakeParameters = require(path.join(
  __dirname,
  '..',
  'node_modules',
  'mediasoup-client',
  'lib',
  'test',
  'fakeParameters.js',
));

const SERVER_URL = process.env.SFU_URL || 'http://localhost:3001';
const ROOM_ID = process.env.SFU_ROOM || 'demo';
const CLIENTS = Number(process.env.SFU_CLIENTS || 2);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createFakeTrack(kind) {
  return new FakeMediaStreamTrack({kind});
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

    const handlerFactory = FakeHandler.FakeHandler.createFactory(fakeParameters);
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

    const audioTrack = createFakeTrack('audio');
    const videoTrack = createFakeTrack('video');

    this.audioProducer = await this.sendTransport.produce({
      track: audioTrack,
      appData: {type: 'audio', name: this.name},
    });

    this.videoProducer = await this.sendTransport.produce({
      track: videoTrack,
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

    if (this.socket) this.socket.disconnect();
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

    // Ask server-side stats for this peer (producer/consumer flow).
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
    if (totalBytes === 0 && serverStats.consumer.bytesSent === 0) {
      console.log(
        `[${this.name}] NOTE: FakeHandler test validates signaling flow only (no real RTP).`,
      );
    }
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
