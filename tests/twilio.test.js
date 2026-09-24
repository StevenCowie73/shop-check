'use strict';

/* The three webhooks, exercised offline.

   Nothing here touches Twilio. fetch is replaced for the duration of each
   test that expects a message, so what would have been sent is asserted
   instead of sent. */

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

const { expectedSignature } = require('../lib/twilio.js');

const SID = 'ACtest00000000000000000000000000';
const TOKEN = 'a-dummy-auth-token-for-tests';
/* 555-01XX is the range reserved for fiction; none of these can ring. */
const OWNER = '+13185550101';
const CALLER = '+13185550102';
const BUSINESS = '+13185550103';
const BASE = 'https://example.test';

function fakeReq(path, params, { signature, method = 'POST' } = {}) {
  const body = new URLSearchParams(params).toString();
  const req = Readable.from([Buffer.from(body, 'utf8')]);
  req.method = method;
  req.url = path;
  req.headers = {
    host: 'example.test',
    'x-forwarded-proto': 'https',
    'content-type': 'application/x-www-form-urlencoded'
  };
  const sig = signature === undefined
    ? expectedSignature(TOKEN, BASE + path, params)
    : signature;
  if (sig !== null) req.headers['x-twilio-signature'] = sig;
  return req;
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk) { this.body = chunk === undefined ? '' : String(chunk); this.ended = true; }
  };
}

function withEnv(vars, fn) {
  const saved = {};
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'OWNER_CELL', 'AUTO_TEXT', 'PUBLIC_BASE_URL',
                'TEXTING_LIVE'];
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  return (async () => {
    try { return await fn(); }
    finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  })();
}

const CONFIGURED = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, OWNER_CELL: OWNER };
/* Texting switched on, as it will be once the carriers approve it. */
const LIVE = { ...CONFIGURED, TEXTING_LIVE: 'true' };

/* Replaces fetch and records what a route tried to send.

   Two Twilio calls matter here: a GET to Messages.json asking whether we
   already texted this number, and a POST to send one. `recent` says what the
   lookup should answer, or 'fail' to make it break. */
function captureSends(fn, { recent = [], lookup = 'ok' } = {}) {
  const sent = [];
  const looked = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'GET') {
      looked.push(String(url));
      if (lookup === 'fail') return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ messages: recent }), text: async () => '{}' };
    }
    sent.push({ url: String(url), params: Object.fromEntries(new URLSearchParams(init.body)), init });
    return { ok: true, status: 201, json: async () => ({ sid: 'SMtest' }), text: async () => '{}' };
  };
  return (async () => {
    try { await fn(sent, looked); }
    finally { global.fetch = realFetch; }
  })();
}

const routes = {
  voice: require('../api/twilio/voice.js'),
  dialStatus: require('../api/twilio/dial-status.js'),
  sms: require('../api/twilio/sms.js')
};

/* ---------- the gate ---------- */

test('every route refuses a bad signature with 403', async () => {
  for (const [name, path, params] of [
    ['voice', '/api/twilio/voice', { From: CALLER, To: BUSINESS }],
    ['dialStatus', '/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'no-answer' }],
    ['sms', '/api/twilio/sms', { From: CALLER, To: BUSINESS, Body: 'hello' }]
  ]) {
    await withEnv(CONFIGURED, async () => {
      const res = fakeRes();
      await routes[name](fakeReq(path, params, { signature: 'not-the-right-signature' }), res);
      assert.strictEqual(res.statusCode, 403, name + ' should be 403');
      assert.match(res.body, /Bad signature/);
    });
  }
});

test('every route refuses a missing signature header with 403', async () => {
  await withEnv(CONFIGURED, async () => {
    const res = fakeRes();
    await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER }, { signature: null }), res);
    assert.strictEqual(res.statusCode, 403);
  });
});

test('missing Twilio credentials give 503, not a crash', async () => {
  for (const name of ['voice', 'dialStatus', 'sms']) {
    await withEnv({}, async () => {
      const res = fakeRes();
      await routes[name](fakeReq('/api/twilio/voice', { From: CALLER }), res);
      assert.strictEqual(res.statusCode, 503, name + ' should be 503');
      assert.match(res.body, /Not configured/);
    });
  }
});

test('missing OWNER_CELL gives 503 on the routes that need it', async () => {
  await withEnv({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN }, async () => {
    for (const name of ['voice', 'sms']) {
      const res = fakeRes();
      await routes[name](fakeReq('/api/twilio/voice', { From: CALLER }), res);
      assert.strictEqual(res.statusCode, 503, name + ' should be 503');
      assert.match(res.body, /OWNER_CELL/);
    }
  });
});

test('a bad OWNER_CELL is rejected as unconfigured', async () => {
  await withEnv({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, OWNER_CELL: '555 0100' }, async () => {
    const res = fakeRes();
    await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER }), res);
    assert.strictEqual(res.statusCode, 503);
  });
});

test('GET is refused', async () => {
  await withEnv(CONFIGURED, async () => {
    const res = fakeRes();
    await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER }, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 405);
  });
});

/* ---------- voice ---------- */

test('voice dials the owner for 20 seconds with the caller as caller id', async () => {
  await withEnv(CONFIGURED, async () => {
    const res = fakeRes();
    await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER, To: BUSINESS }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/xml/);
    assert.match(res.body, /<Dial timeout="20"/);
    assert.match(res.body, new RegExp('callerId="\\' + CALLER + '"'));
    assert.match(res.body, new RegExp('<Number>\\' + OWNER + '</Number>'));
    assert.match(res.body, /action="https:\/\/example\.test\/api\/twilio\/dial-status"/);
    assert.match(res.body, /method="POST"/);
  });
});

test('with texting off the call rings straight through, no disclosure', async () => {
  for (const flag of [undefined, 'false', 'TRUE']) {
    const env = flag === undefined ? CONFIGURED : { ...CONFIGURED, TEXTING_LIVE: flag };
    await withEnv(env, async () => {
      const res = fakeRes();
      await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER, To: BUSINESS }), res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.includes('<Say>'), false, 'nothing said with TEXTING_LIVE ' + flag);
      assert.match(res.body, /<Response><Dial timeout="20"/, 'the Dial comes first');
    });
  }
});

test('with texting live the caller hears the disclosure, then it rings through', async () => {
  const { VOICE_DISCLOSURE } = require('../lib/texting-copy.js');
  assert.strictEqual(VOICE_DISCLOSURE,
    "Thanks for calling ColdenJames. If I miss your call, I'll text you back at this number. " +
    'Message and data rates may apply. Reply STOP to opt out.');
  await withEnv(LIVE, async () => {
    const res = fakeRes();
    await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER, To: BUSINESS }), res);
    assert.strictEqual(res.statusCode, 200);
    const say = /<Say>([^<]*)<\/Say>/.exec(res.body);
    assert.ok(say, 'a disclosure is spoken');
    assert.strictEqual(say[1].replace(/&apos;/g, "'"), VOICE_DISCLOSURE);
    assert.ok(res.body.indexOf('<Say>') < res.body.indexOf('<Dial'), 'before the call rings through');
    assert.match(res.body, /<Dial timeout="20"/);
    assert.match(res.body, new RegExp('<Number>\\' + OWNER + '</Number>'));
    assert.strictEqual((res.body.match(/<Say>/g) || []).length, 1, 'said once');
  });
});

test('the missed-call text is the shared wording', () => {
  const { MISSED_CALL_TEXT } = require('../lib/texting-copy.js');
  assert.strictEqual(MISSED_CALL_TEXT,
    "Hi, this is Steven at ColdenJames. Sorry I missed your call. I'll get back to you today, " +
    'or just text me here. Reply STOP to opt out.');
});

/* ---------- dial-status ---------- */

test('an answered call sends nothing and just hangs up', async () => {
  await withEnv(LIVE, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'completed' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.includes('<Hangup/>'), true);
    assert.strictEqual(res.body.includes('<Say>'), false);
    assert.deepStrictEqual(sent, []);
  }));
});

for (const status of ['no-answer', 'busy', 'failed', 'canceled']) {
  test(`a ${status} call texts the caller once and says so`, async () => {
    await withEnv(LIVE, () => captureSends(async sent => {
      const res = fakeRes();
      await routes.dialStatus(
        fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: status }), res);

      assert.strictEqual(sent.length, 1, 'exactly one message');
      assert.match(sent[0].url, /api\.twilio\.com\/2010-04-01\/Accounts\/ACtest.*\/Messages\.json/);
      assert.strictEqual(sent[0].params.To, CALLER, 'texts the caller');
      assert.strictEqual(sent[0].params.From, BUSINESS, 'from the business number');
      assert.match(sent[0].params.Body, /^Hi, this is Steven at ColdenJames\./);
      assert.match(sent[0].params.Body, /Sorry I missed your call/);
      assert.match(sent[0].params.Body, /Reply STOP to opt out\./);
      assert.match(sent[0].init.headers.Authorization, /^Basic /);

      assert.strictEqual(res.statusCode, 200);
      assert.match(res.body, /<Say>Sorry I missed you\. I've just sent you a text\.<\/Say>/);
      assert.match(res.body, /<Hangup\/>/);
    }));
  });
}

test('AUTO_TEXT overrides the message', async () => {
  await withEnv({ ...LIVE, AUTO_TEXT: 'Custom wording here.' }, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'busy' }), res);
    assert.strictEqual(sent[0].params.Body, 'Custom wording here.');
  }));
});

test('an unknown dial status is treated as a miss', async () => {
  await withEnv(LIVE, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'anything-else' }), res);
    assert.strictEqual(sent.length, 1);
  }));
});

test('when Twilio refuses the message the caller is not promised one', async () => {
  await withEnv(LIVE, async () => {
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (!init || (init.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' };
      }
      return { ok: false, status: 400, text: async () => 'nope', json: async () => ({}) };
    };
    try {
      const res = fakeRes();
      await routes.dialStatus(
        fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'no-answer' }), res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.includes('<Say>'), false, 'must not claim a text was sent');
      assert.match(res.body, /<Hangup\/>/);
    } finally { global.fetch = realFetch; }
  });
});

/* ---------- one text per caller per day ---------- */

test('a first call in 24 hours gets the text', async () => {
  await withEnv(LIVE, () => captureSends(async (sent, looked) => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'no-answer' }), res);

    assert.strictEqual(looked.length, 1, 'it asked Twilio first');
    assert.match(looked[0], /Messages\.json\?/);
    assert.match(looked[0], /To=%2B13185550102/, 'asked about this caller');
    assert.match(looked[0], /From=%2B13185550103/, 'from our number');
    assert.match(looked[0], /DateSent%3E=/, 'within a window');

    assert.strictEqual(sent.length, 1, 'and sent the text');
    assert.match(res.body, /<Say>Sorry I missed you\. I've just sent you a text\.<\/Say>/);
  }, { recent: [] }));
});

test('a second call within 24 hours gets no text, and a different line', async () => {
  await withEnv(LIVE, () => captureSends(async (sent, looked) => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'busy' }), res);

    assert.strictEqual(looked.length, 1, 'it asked');
    assert.deepStrictEqual(sent, [], 'and sent nothing');
    assert.match(res.body, /<Say>Sorry I missed you\. I'll call you back\.<\/Say>/);
    assert.match(res.body, /<Hangup\/>/);
    assert.strictEqual(res.body.includes("just sent you a text"), false,
      'must not claim a text that was not sent');
  }, { recent: [{ sid: 'SMearlier' }] }));
});

test('if the lookup fails the text goes out anyway', async () => {
  await withEnv(LIVE, () => captureSends(async (sent, looked) => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'no-answer' }), res);

    assert.strictEqual(looked.length, 1, 'it tried to ask');
    assert.strictEqual(sent.length, 1, 'a missed text is worse than a duplicate');
    assert.match(res.body, /just sent you a text/);
  }, { lookup: 'fail' }));
});

test('an answered call never even asks', async () => {
  await withEnv(LIVE, () => captureSends(async (sent, looked) => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'completed' }), res);
    assert.deepStrictEqual(looked, []);
    assert.deepStrictEqual(sent, []);
  }));
});

/* ---------- texting switched off ---------- */

for (const flag of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
  test(`with TEXTING_LIVE ${JSON.stringify(flag)} a missed call sends nothing and promises nothing`, async () => {
    const env = flag === undefined ? CONFIGURED : { ...CONFIGURED, TEXTING_LIVE: flag };
    await withEnv(env, () => captureSends(async (sent, looked) => {
      const res = fakeRes();
      await routes.dialStatus(
        fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'no-answer' }), res);
      assert.deepStrictEqual(sent, [], 'no text');
      assert.deepStrictEqual(looked, [], 'no lookup either');
      assert.strictEqual(res.statusCode, 200);
      assert.match(res.body, /<Say>Sorry I missed you\. I'll call you back\.<\/Say>/);
      assert.match(res.body, /<Hangup\/>/);
      assert.strictEqual(res.body.includes('sent you a text'), false);
    }));
  });
}

test('with texting off an answered call still just hangs up', async () => {
  await withEnv(CONFIGURED, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'completed' }), res);
    assert.strictEqual(res.body.includes('<Say>'), false);
    assert.match(res.body, /<Hangup\/>/);
    assert.deepStrictEqual(sent, []);
  }));
});

test('TEXTING_LIVE "true" with stray whitespace still counts as on', async () => {
  await withEnv({ ...CONFIGURED, TEXTING_LIVE: ' true\n' }, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'busy' }), res);
    assert.strictEqual(sent.length, 1);
    assert.match(res.body, /just sent you a text/);
  }));
});

/* ---------- sms ---------- */

test('an inbound text is forwarded to the owner and gets no reply', async () => {
  await withEnv(CONFIGURED, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.sms(
      fakeReq('/api/twilio/sms', { From: CALLER, To: BUSINESS, Body: 'can you quote a roof' }), res);

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].params.To, OWNER, 'forwards to the owner');
    assert.strictEqual(sent[0].params.From, BUSINESS);
    assert.strictEqual(sent[0].params.Body, 'From ' + CALLER + ': can you quote a roof');

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.includes('<Message'), false, 'no auto-reply to the sender');
    assert.match(res.body, /<Response><\/Response>/);
  }));
});

test('STOP is forwarded but never answered', async () => {
  await withEnv(CONFIGURED, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.sms(fakeReq('/api/twilio/sms', { From: CALLER, To: BUSINESS, Body: 'STOP' }), res);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].params.To, OWNER, 'only ever the owner, never the sender');
    assert.strictEqual(res.body.includes('<Message'), false);
  }));
});

/* ---------- the guard rails ---------- */

test('a destination in a request parameter is ignored', async () => {
  await withEnv(CONFIGURED, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.sms(fakeReq('/api/twilio/sms', {
      From: CALLER, To: BUSINESS, Body: 'hi',
      ForwardTo: '+13185550199', Destination: '+13185550199'
    }), res);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].params.To, OWNER, 'still the owner, not the injected number');
  }));
});

test('sendSms refuses a destination that is not E.164', async () => {
  const { sendSms } = require('../lib/twilio.js');
  await assert.rejects(
    () => sendSms({ sid: SID, token: TOKEN, from: BUSINESS, to: 'not-a-number', body: 'x' }),
    /E\.164/);
});

test('the Twilio routes do not read LOOKUP_PASSWORD', () => {
  const fs = require('fs');
  for (const f of ['api/twilio/voice.js', 'api/twilio/dial-status.js', 'api/twilio/sms.js', 'lib/twilio.js']) {
    assert.strictEqual(fs.readFileSync(f, 'utf8').includes('LOOKUP_PASSWORD'), false, f);
  }
});

test('the signature is computed over url plus sorted parameters', () => {
  const params = { B: '2', A: '1' };
  const crypto = require('node:crypto');
  const byHand = crypto.createHmac('sha1', TOKEN).update('https://x.test/hookA1B2').digest('base64');
  assert.strictEqual(expectedSignature(TOKEN, 'https://x.test/hook', params), byHand);
});
