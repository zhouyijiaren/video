'use strict';

const puppeteer = require('puppeteer-core');

const SERVER_URL = process.env.SERVER_URL || 'http://host.docker.internal:3001';
const CLIENT_URL = process.env.CLIENT_URL || 'http://host.docker.internal:8080';
const ROOM_ID = process.env.ROOM_ID || 'demo';
const FAKE_MEDIA = process.env.FAKE_MEDIA || '';
const TRANSPORTS = process.env.TRANSPORTS || '';

const joinParams = new URLSearchParams({
  server: SERVER_URL,
  room: ROOM_ID,
  autojoin: '1',
});
if (FAKE_MEDIA) {
  joinParams.set('fake', FAKE_MEDIA);
}
if (TRANSPORTS) {
  joinParams.set('transport', TRANSPORTS);
}
const JOIN_URL = `${CLIENT_URL}/?${joinParams.toString()}`;

async function preflight() {
  const targets = [
    new URL('/health', SERVER_URL).toString(),
    CLIENT_URL,
  ];
  for (const url of targets) {
    try {
      const res = await fetch(url, {method: 'GET'});
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      console.log(`[test] preflight ok ${url}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      throw new Error(`[test] preflight failed ${url} (${message})`);
    }
  }
}

async function openClient(browser, name) {
  const context = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  page.on('console', msg => {
    void (async () => {
      const args = await Promise.all(
        msg.args().map(arg => arg.jsonValue().catch(() => `[${arg.toString()}]`)),
      );
      const rendered = args.map(value => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch (_) {
          return String(value);
        }
      });
      if (rendered.length) {
        console.log(`[${name}] console ${msg.type()}: ${rendered.join(' ')}`);
      } else {
        console.log(`[${name}] console ${msg.type()}: ${msg.text()}`);
      }
    })();
  });
  page.on('pageerror', err => {
    console.log(`[${name}] pageerror: ${err.message}`);
  });
  page.on('requestfailed', req => {
    console.log(`[${name}] request failed: ${req.url()} ${req.failure()?.errorText}`);
  });

  await page.goto(JOIN_URL, {waitUntil: 'domcontentloaded'});

  await page.waitForFunction(() => !!window.__demoStats, {timeout: 20000});

  const env = await page.evaluate(() => {
    return {
      userAgent: navigator.userAgent,
      hasRTCPeerConnection: typeof RTCPeerConnection !== 'undefined',
      hasRTCRtpSender: typeof RTCRtpSender !== 'undefined',
      senderCaps: typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities
        ? RTCRtpSender.getCapabilities('video')
        : null,
    };
  });
  console.log(`[${name}] env`, JSON.stringify(env));
  const globals = await page.evaluate(() => ({
    mediasoupClient: !!window.mediasoupClient,
    mediasoupClientType: typeof window.mediasoupClient,
    ioLoaded: typeof io !== 'undefined',
  }));
  console.log(`[${name}] globals`, JSON.stringify(globals));

  let ready = await page.waitForFunction(
    () => window.__demoStats().joined,
    {timeout: 15000},
  ).catch(() => null);

  if (!ready) {
    // Try to (re)inject vendor script and re-join.
    await page.addScriptTag({url: `${CLIENT_URL}/vendor/mediasoup-client.min.js?v=7`});
    await page.evaluate(() => {
      if (!window.mediasoupClient && typeof mediasoupClient !== 'undefined') {
        window.mediasoupClient = mediasoupClient;
      }
      if (window.__demoJoin) {
        window.__demoJoin();
      }
    });
    ready = await page.waitForFunction(
      () => window.__demoStats().joined,
      {timeout: 15000},
    ).catch(() => null);
  }

  if (!ready) {
    const stats = await page.evaluate(() => window.__demoStats());
    throw new Error(`[${name}] join timeout, stats=${JSON.stringify(stats)}`);
  }

  console.log(`[${name}] joined`);
  return {context, page};
}

async function waitForRemoteVideo(page, name) {
  const initial = await page.evaluate(async () => {
    if (!window.__demoStatsDetailed) return null;
    return await window.__demoStatsDetailed();
  });
  console.log(`[${name}] initial stats`, initial);

  await page.waitForFunction(async () => {
    if (!window.__demoStatsDetailed) return false;
    const stats = await window.__demoStatsDetailed();
    return stats.recvBytes > 0;
  }, {timeout: 20000});

  const stats = await page.evaluate(async () => {
    const basic = window.__demoStats();
    const detail = await window.__demoStatsDetailed();
    return {basic, detail};
  });
  console.log(
    `[${name}] recvBytes=${stats.detail.recvBytes} sendBytes=${stats.detail.sendBytes} ` +
      `remoteVideo.live=${stats.basic.remoteVideo.live} consumers=${stats.basic.consumers}`,
  );
}

async function run() {
  console.log(`[test] using ${JOIN_URL}`);
  await preflight();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--unsafely-treat-insecure-origin-as-secure=${CLIENT_URL}`,
      '--allow-insecure-localhost',
      '--disable-features=BlockInsecurePrivateNetworkRequests'
    ]
  });

  const c1 = await openClient(browser, 'client-1');
  const c2 = await openClient(browser, 'client-2');

  await waitForRemoteVideo(c1.page, 'client-1');
  await waitForRemoteVideo(c2.page, 'client-2');

  await c1.context.close();
  await c2.context.close();
  await browser.close();

  console.log('[test] done');
}

run().catch(err => {
  console.error('[test] failed', err);
  process.exit(1);
});
