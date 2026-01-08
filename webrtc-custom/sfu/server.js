'use strict';

const http = require('http');
const express = require('express');
const {Server} = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let worker;

const rooms = new Map();
const peers = new Map();
const consumerKeyframeIntervals = new Map();

async function createWorker() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on('died', () => {
    console.error('[mediasoup] worker died, exiting in 2s...');
    setTimeout(() => process.exit(1), 2000);
  });
}

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room) return room;

  const router = await worker.createRouter(config.mediasoup.router);
  room = {
    id: roomId,
    router,
    peers: new Set(),
  };
  rooms.set(roomId, room);
  return room;
}

function getPeer(socketId) {
  return peers.get(socketId);
}

function sanitizeAppData(appData) {
  if (!appData || typeof appData !== 'object') return {};
  return {
    type: appData.type,
    screenShareUid: appData.screenShareUid,
    source: appData.source,
  };
}

function findProducer(roomId, producerId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const peerId of room.peers.values()) {
    const peer = peers.get(peerId);
    if (!peer) continue;
    for (const producer of peer.producers.values()) {
      if (producer.id === producerId) {
        return {producer, peer};
      }
    }
  }
  return null;
}

function cleanupPeer(socketId) {
  const peer = peers.get(socketId);
  if (!peer) return;

  for (const consumer of peer.consumers.values()) {
    try {
      consumer.close();
    } catch (_) {}
    if (consumerKeyframeIntervals.has(consumer.id)) {
      clearInterval(consumerKeyframeIntervals.get(consumer.id));
      consumerKeyframeIntervals.delete(consumer.id);
    }
  }
  for (const producer of peer.producers.values()) {
    try {
      producer.close();
    } catch (_) {}
  }
  for (const transport of peer.transports.values()) {
    try {
      transport.close();
    } catch (_) {}
  }

  const room = rooms.get(peer.roomId);
  if (room) {
    room.peers.delete(socketId);
    if (room.peers.size === 0) {
      rooms.delete(peer.roomId);
    } else {
      io.to(peer.roomId).emit('userLeft', {
        uid: peer.uid,
        peerId: socketId,
        screenShareUid: peer.screenShareUid,
      });
    }
  }

  peers.delete(socketId);
}

function roomProducers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const producers = [];
  for (const peerId of room.peers.values()) {
    const peer = peers.get(peerId);
    if (!peer) continue;
    for (const producer of peer.producers.values()) {
      producers.push({
        producerId: producer.id,
        peerId,
        uid: peer.uid,
        kind: producer.kind,
        appData: sanitizeAppData(producer.appData),
      });
    }
  }
  return producers;
}

io.on('connection', socket => {
  socket.on('join', async ({roomId, uid, screenShareUid, rtpCapabilities}) => {
    if (!roomId) {
      socket.emit('error', {message: 'Invalid join payload'});
      return;
    }

    const room = await getOrCreateRoom(roomId);

    const peer = {
      id: socket.id,
      roomId,
      uid,
      screenShareUid,
      rtpCapabilities: rtpCapabilities || null,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };

    peers.set(socket.id, peer);
    room.peers.add(socket.id);
    socket.join(roomId);

    socket.emit('joined', {
      rtpCapabilities: room.router.rtpCapabilities,
      existingProducers: roomProducers(roomId),
    });

    socket.to(roomId).emit('userJoined', {
      uid,
      peerId: socket.id,
      screenShareUid,
    });
  });

  socket.on('setRtpCapabilities', ({rtpCapabilities}) => {
    const peer = getPeer(socket.id);
    if (!peer || !rtpCapabilities) return;
    peer.rtpCapabilities = rtpCapabilities;
  });

  socket.on('getProducers', () => {
    const peer = getPeer(socket.id);
    if (!peer) return;
    socket.emit('producers', roomProducers(peer.roomId));
  });

  socket.on('createWebRtcTransport', async ({consumer}) => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    const room = rooms.get(peer.roomId);
    if (!room) return;

    const transport = await room.router.createWebRtcTransport(
      config.mediasoup.webRtcTransport,
    );

    if (config.mediasoup.webRtcTransport.maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(
          config.mediasoup.webRtcTransport.maxIncomingBitrate,
        );
      } catch (_) {}
    }

    peer.transports.set(transport.id, transport);

    transport.on('dtlsstatechange', dtlsState => {
      console.log(`[sfu] transport ${transport.id} dtlsstate ${dtlsState}`);
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('icestatechange', iceState => {
      console.log(`[sfu] transport ${transport.id} icestate ${iceState}`);
    });

    transport.on('close', () => {
      peer.transports.delete(transport.id);
    });

    socket.emit('transportCreated', {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
      consumer: !!consumer,
    });
  });

  socket.on('connectTransport', async ({transportId, dtlsParameters}) => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    const transport = peer.transports.get(transportId);
    if (!transport) return;

    await transport.connect({dtlsParameters});
    socket.emit('transportConnected', {transportId});
  });

  socket.on('produce', async ({transportId, kind, rtpParameters, appData}) => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    const transport = peer.transports.get(transportId);
    if (!transport) return;

    const producer = await transport.produce({kind, rtpParameters, appData});
    peer.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
    });

    producer.on('close', () => {
      peer.producers.delete(producer.id);
    });

    const room = rooms.get(peer.roomId);
    if (room) {
      socket.to(peer.roomId).emit('newProducer', {
        producerId: producer.id,
        peerId: socket.id,
        uid: peer.uid,
        kind: producer.kind,
        appData: sanitizeAppData(producer.appData),
      });
    }

    socket.emit('produced', {producerId: producer.id});
  });

  socket.on(
    'consume',
    async ({transportId, producerId, rtpCapabilities}) => {
      const peer = getPeer(socket.id);
      if (!peer) return;

      const room = rooms.get(peer.roomId);
      if (!room) return;

      if (!room.router.canConsume({producerId, rtpCapabilities})) {
        socket.emit('error', {message: 'Cannot consume'});
        return;
      }

      const transport = peer.transports.get(transportId);
      if (!transport) return;

      const producerInfo = findProducer(peer.roomId, producerId);
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);
      if (consumer.kind === 'video' && consumer.requestKeyFrame) {
        const interval = setInterval(() => {
          consumer.requestKeyFrame().catch(() => {});
        }, 2000);
        consumerKeyframeIntervals.set(consumer.id, interval);
      }

      consumer.on('transportclose', () => {
        peer.consumers.delete(consumer.id);
        if (consumerKeyframeIntervals.has(consumer.id)) {
          clearInterval(consumerKeyframeIntervals.get(consumer.id));
          consumerKeyframeIntervals.delete(consumer.id);
        }
      });

      consumer.on('close', () => {
        if (consumerKeyframeIntervals.has(consumer.id)) {
          clearInterval(consumerKeyframeIntervals.get(consumer.id));
          consumerKeyframeIntervals.delete(consumer.id);
        }
      });

      consumer.on('producerpause', () => {
        socket.emit('producerPaused', {producerId});
      });

      consumer.on('producerresume', async () => {
        socket.emit('producerResumed', {producerId});
        if (consumer.kind === 'video' && consumer.requestKeyFrame) {
          try {
            await consumer.requestKeyFrame();
          } catch (_) {}
        }
      });

      consumer.on('producerclose', () => {
        if (consumerKeyframeIntervals.has(consumer.id)) {
          clearInterval(consumerKeyframeIntervals.get(consumer.id));
          consumerKeyframeIntervals.delete(consumer.id);
        }
        peer.consumers.delete(consumer.id);
        socket.emit('producerClosed', {producerId});
      });

      socket.emit('consuming', {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        appData: producerInfo ? sanitizeAppData(producerInfo.producer.appData) : {},
        uid: producerInfo ? producerInfo.peer.uid : undefined,
      });
    },
  );

  socket.on('resume', async ({consumerId}) => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    const consumer = peer.consumers.get(consumerId);
    if (!consumer) return;

    await consumer.resume();
    if (consumer.kind === 'video' && consumer.requestKeyFrame) {
      try {
        await consumer.requestKeyFrame();
      } catch (_) {}
    }
    socket.emit('resumed', {consumerId});
  });

  socket.on('closeProducer', ({producerId}) => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    const producer = peer.producers.get(producerId);
    if (!producer) return;

    producer.close();
    peer.producers.delete(producerId);
  });

  socket.on('getStats', async () => {
    const peer = getPeer(socket.id);
    if (!peer) return;

    let producerBytes = 0;
    let producerPackets = 0;
    let consumerBytes = 0;
    let consumerPackets = 0;

    for (const producer of peer.producers.values()) {
      try {
        const stats = await producer.getStats();
        for (const report of stats.values()) {
          if (typeof report.bytesReceived === 'number') {
            producerBytes += report.bytesReceived;
          }
          if (typeof report.packetsReceived === 'number') {
            producerPackets += report.packetsReceived;
          }
        }
      } catch (_) {}
    }

    for (const consumer of peer.consumers.values()) {
      try {
        const stats = await consumer.getStats();
        for (const report of stats.values()) {
          if (typeof report.bytesSent === 'number') {
            consumerBytes += report.bytesSent;
          }
          if (typeof report.packetsSent === 'number') {
            consumerPackets += report.packetsSent;
          }
        }
      } catch (_) {}
    }

    socket.emit('stats', {
      producer: {bytesReceived: producerBytes, packetsReceived: producerPackets},
      consumer: {bytesSent: consumerBytes, packetsSent: consumerPackets},
    });
  });

  socket.on('disconnect', () => {
    cleanupPeer(socket.id);
  });
});

app.get('/health', (_req, res) => {
  res.json({ok: true});
});

(async () => {
  await createWorker();
  server.listen(config.http.port, () => {
    console.log(`SFU server listening on :${config.http.port}`);
  });
})();
