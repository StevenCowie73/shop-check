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

/* What the routes should play, by recording name: an absolute URL on the
   host Twilio called, pointing at the file voice.json names. */
const { recordings: RECORDINGS } = require('../public/audio/voice.json');
const PLAY = name => '<Play>' + BASE + '/audio/' + RECORDINGS[name].file + '</Play>';
const plays = (body, name) => body.includes(PLAY(name));

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

test('the recorded disclosure plays before the call rings through, whatever TEXTING_LIVE says', async () => {
  const { VOICE_DISCLOSURE } = require('../lib/texting-copy.js');
  assert.strictEqual(VOICE_DISCLOSURE,
    "Thanks for calling ColdenJames. If we miss your call, we'll text you back at this number. " +
    'Message and data rates may apply. Reply STOP to opt out.');
  assert.strictEqual(RECORDINGS.greeting.text, VOICE_DISCLOSURE, 'the greeting recording is of that wording');
  for (const flag of [undefined, '', 'false', 'TRUE', 'true']) {
    const env = flag === undefined ? CONFIGURED : { ...CONFIGURED, TEXTING_LIVE: flag };
    await withEnv(env, async () => {
      const res = fakeRes();
      await routes.voice(fakeReq('/api/twilio/voice', { From: CALLER, To: BUSINESS }), res);
      const label = 'TEXTING_LIVE ' + JSON.stringify(flag);
      assert.strictEqual(res.statusCode, 200, label);
      assert.ok(res.body.startsWith('<?xml') || res.body.includes('<Response>'), label);
      assert.ok(res.body.includes('<Response>' + PLAY('greeting') + '<Dial timeout="20"'),
        'Play the greeting first, then Dial: ' + label);
      assert.match(res.body, new RegExp('<Number>\\' + OWNER + '</Number>'), label);
      assert.strictEqual((res.body.match(/<Play>/g) || []).length, 1, 'played once: ' + label);
      assert.strictEqual(res.body.includes('<Say>'), false, 'no robot voice: ' + label);
    });
  }
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
    assert.strictEqual(res.body.includes('<Play>'), false);
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
      assert.ok(plays(res.body, 'missed-call-on'), 'plays "we\'ve just sent you a text"');
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
      assert.strictEqual(res.body.includes('<Play>'), false, 'must not claim a text was sent');
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
    assert.ok(plays(res.body, 'missed-call-on'));
  }, { recent: [] }));
});

test('a second call within 24 hours gets no text, and a different line', async () => {
  await withEnv(LIVE, () => captureSends(async (sent, looked) => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'busy' }), res);

    assert.strictEqual(looked.length, 1, 'it asked');
    assert.deepStrictEqual(sent, [], 'and sent nothing');
    assert.ok(plays(res.body, 'missed-call-off'), 'plays "Steven will call you back"');
    assert.match(res.body, /<Hangup\/>/);
    assert.strictEqual(plays(res.body, 'missed-call-on'), false,
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
    assert.ok(plays(res.body, 'missed-call-on'));
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
      assert.ok(plays(res.body, 'missed-call-off'), 'plays "Steven will call you back"');
      assert.match(res.body, /<Hangup\/>/);
      assert.strictEqual(plays(res.body, 'missed-call-on'), false);
    }));
  });
}

test('with texting off an answered call still just hangs up', async () => {
  await withEnv(CONFIGURED, () => captureSends(async sent => {
    const res = fakeRes();
    await routes.dialStatus(
      fakeReq('/api/twilio/dial-status', { From: CALLER, To: BUSINESS, DialCallStatus: 'completed' }), res);
    assert.strictEqual(res.body.includes('<Play>'), false);
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
    assert.ok(plays(res.body, 'missed-call-on'));
  }));
});

/* ---------- sms ---------- */

/* A stand-in for Twilio that keeps a small call and text log for the
   business number and answers list queries against it the way Twilio does
   (To / From filters, newest first). Sends are recorded, never made. */
function fakeTwilio(fn, { messages = [], calls = [], refuse = null, logsDown = false } = {}) {
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    const method = (init && init.method) || 'GET';
    if (method === 'GET') {
      if (logsDown) return { ok: false, status: 503, text: async () => 'down', json: async () => ({}) };
      const q = u.searchParams;
      const isCalls = /\/Calls\.json$/.test(u.pathname);
      const rows = (isCalls ? calls : messages)
        .filter(r => (!q.get('To') || r.to === q.get('To')) && (!q.get('From') || r.from === q.get('From')))
        .slice(0, Number(q.get('PageSize') || 50));
      return { ok: true, status: 200, json: async () => (isCalls ? { calls: rows } : { messages: rows }),
               text: async () => '{}' };
    }
    const params = Object.fromEntries(new URLSearchParams(init.body));
    if (refuse && params.To !== OWNER) {
      return { ok: false, status: 400, json: async () => ({}),
               text: async () => JSON.stringify({ code: refuse, message: 'refused' }) };
    }
    sent.push(params);
    return { ok: true, status: 201, json: async () => ({ sid: 'SMtest' }), text: async () => '{}' };
  };
  return (async () => {
    try { await fn(sent); } finally { global.fetch = realFetch; }
  })();
}

/* 555-01XX numbers are reserved for fiction. */
const OTHER = '+13185550142';
const STRANGER = '+13185550177';
const inText = (from, at) => ({ from, to: BUSINESS, direction: 'inbound', date_sent: at });
const inCall = (from, at) => ({ from, to: BUSINESS, direction: 'inbound', start_time: at });
const smsFrom = (from, Body, extra = {}) =>
  fakeReq('/api/twilio/sms', { From: from, To: BUSINESS, Body, ...extra });

test('an inbound text is forwarded to the owner in the campaign sample format, with no reply', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    const res = fakeRes();
    await routes.sms(smsFrom(OTHER, 'Can you call me back about a fence repair quote?'), res);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].To, OWNER, 'forwards to the owner');
    assert.strictEqual(sent[0].From, BUSINESS);
    assert.strictEqual(sent[0].Body,
      'ColdenJames: new text from +1 318-555-0142: "Can you call me back about a fence repair quote?" Reply STOP to opt out.',
      'exactly campaign sample 3');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.includes('<Message'), false, 'no auto-reply to the sender');
    assert.match(res.body, /<Response><\/Response>/);
  }));
});

test('STOP from a customer is forwarded but never answered', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    const res = fakeRes();
    await routes.sms(smsFrom(CALLER, 'STOP'), res);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].To, OWNER, 'only ever the owner, never the sender');
    assert.strictEqual(res.body.includes('<Message'), false);
  }));
});

test("the owner's own texts are never forwarded back to the owner", async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, 'On my way, 10 minutes'), fakeRes());
    assert.strictEqual(sent.some(m => m.To === OWNER && /new text from/.test(m.Body)), false);
    assert.strictEqual(sent.length, 1, 'one reply went out');
    assert.strictEqual(sent[0].To, OTHER);
  }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 10:00:00 +0000')] }));
});

test('a reply goes to whoever last texted or called, from the business number, word for word', async () => {
  const log = {
    messages: [inText(CALLER, 'Thu, 24 Sep 2026 09:00:00 +0000'),
               { from: OWNER, to: BUSINESS, direction: 'inbound', date_sent: 'Thu, 24 Sep 2026 12:00:00 +0000' }],
    calls: [inCall(OTHER, 'Thu, 24 Sep 2026 11:00:00 +0000'),
            inCall('+266696687', 'Thu, 24 Sep 2026 11:30:00 +0000')]
  };
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    const res = fakeRes();
    await routes.sms(smsFrom(OWNER, '  Yes, I can come by at 9. '), res);
    assert.deepStrictEqual(sent.map(m => [m.To, m.From, m.Body]),
      [[OTHER, BUSINESS, 'Yes, I can come by at 9.']],
      'to the latest caller (not the owner, not a withheld number), no prefix added');
    assert.strictEqual(res.body.includes('<Message'), false);
  }, log));
});

for (const [written, words] of [
  ['3185550142 See you at 9', 'See you at 9'],
  ['318-555-0142: See you at 9', 'See you at 9'],
  ['(318) 555-0142 See you at 9', 'See you at 9'],
  ['+1 318 555 0142 - See you at 9', 'See you at 9'],
  ['1-318-555-0142 See you at 9', 'See you at 9'],
  ['+13185550142, See you at 9', 'See you at 9']
]) {
  test(`a reply starting ${JSON.stringify(written.slice(0, 16))} goes to that number, minus the number`, async () => {
    await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
      await routes.sms(smsFrom(OWNER, written), fakeRes());
      assert.deepStrictEqual(sent.map(m => [m.To, m.From, m.Body]), [[OTHER, BUSINESS, words]]);
    }, { messages: [inText(OTHER, 'Wed, 23 Sep 2026 09:00:00 +0000'),
                    inText(CALLER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
  });
}

test('a number that has only called, never texted, can be replied to', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, '318-555-0142 Sorry I missed you'), fakeRes());
    assert.deepStrictEqual(sent.map(m => m.To), [OTHER]);
  }, { calls: [inCall(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
});

test('guard rail: a number that never contacted the business gets nothing, and the owner is told', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, '318-555-0177 hello there'), fakeRes());
    assert.strictEqual(sent.some(m => m.To === STRANGER), false, 'nothing to the stranger');
    assert.deepStrictEqual(sent.map(m => [m.To, m.Body]),
      [[OWNER, "Not sent: that number hasn't contacted ColdenJames."]]);
  }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
});

test('guard rail: a reply naming the owner or the business number is refused', async () => {
  for (const target of ['318-555-0101', '318-555-0103']) {
    await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
      await routes.sms(smsFrom(OWNER, target + ' hi'), fakeRes());
      assert.deepStrictEqual(sent.map(m => [m.To, m.Body]),
        [[OWNER, "Not sent: that number hasn't contacted ColdenJames."]], target);
    }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
  }
});

test('nobody to reply to: the owner is told, nothing else is sent', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, 'Anyone there?'), fakeRes());
    assert.deepStrictEqual(sent.map(m => [m.To, m.Body]),
      [[OWNER, 'Not sent: nobody has called or texted ColdenJames yet.']]);
  }, { messages: [{ from: OWNER, to: BUSINESS, direction: 'inbound', date_sent: 'Thu, 24 Sep 2026 09:00:00 +0000' }],
       calls: [inCall('+266696687', 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
});

test('a refused reply is reported to the owner in one line', async () => {
  for (const [code, line] of [[21610, 'Not sent: that number has replied STOP.'],
                              [21211, 'Not sent: Twilio refused the message.']]) {
    await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
      await routes.sms(smsFrom(OWNER, 'Still need that quote?'), fakeRes());
      assert.deepStrictEqual(sent.map(m => [m.To, m.Body]), [[OWNER, line]], String(code));
    }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')], refuse: code }));
  }
});

test('if the log cannot be read, nothing goes to a customer', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, '318-555-0142 hi'), fakeRes());
    assert.deepStrictEqual(sent.map(m => [m.To, m.Body]),
      [[OWNER, "Not sent: couldn't check the call and text log. Try again."]]);
  }, { logsDown: true }));
});

test('a number with nothing after it is not sent', async () => {
  await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
    await routes.sms(smsFrom(OWNER, '318-555-0142'), fakeRes());
    assert.deepStrictEqual(sent.map(m => [m.To, m.Body]),
      [[OWNER, 'Not sent: there was no message after the number.']]);
  }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
});

test('STOP, HELP and the other Twilio keywords from the owner are left to Twilio', async () => {
  for (const word of ['STOP', 'stop', ' Help ', 'START', 'UNSUBSCRIBE']) {
    await withEnv(CONFIGURED, () => fakeTwilio(async sent => {
      const res = fakeRes();
      await routes.sms(smsFrom(OWNER, word), res);
      assert.deepStrictEqual(sent, [], JSON.stringify(word) + ' is neither relayed nor answered');
      assert.match(res.body, /<Response><\/Response>/);
    }, { messages: [inText(OTHER, 'Thu, 24 Sep 2026 09:00:00 +0000')] }));
  }
});

test('the forward and not-sent wording lives in lib/texting-copy.js', () => {
  const { forwardedText, NOT_SENT } = require('../lib/texting-copy.js');
  const { formatUS } = require('../lib/reply-through.js');
  assert.strictEqual(forwardedText(formatUS('+13185550142'), 'hi'),
    'ColdenJames: new text from +1 318-555-0142: "hi" Reply STOP to opt out.');
  assert.strictEqual(NOT_SENT.notAllowed, "Not sent: that number hasn't contacted ColdenJames.");
});

test('reading a reply: ordinary messages are not mistaken for a number', () => {
  const { parseReply } = require('../lib/reply-through.js');
  for (const t of ['On my way, 10 mins', '1 more thing', '$250 for the job', '318555014 short',
                   '31855501429 too long', 'See you at 9']) {
    assert.deepStrictEqual(parseReply(t), { to: null, message: t }, t);
  }
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

/* ---------- the recordings ---------- */

test('every recording is of the exact wording in lib/texting-copy.js', () => {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { SPOKEN } = require('../lib/texting-copy.js');
  const manifest = require('../public/audio/voice.json');
  assert.deepStrictEqual(Object.keys(manifest.recordings).sort(), Object.keys(SPOKEN).sort(),
    'one recording per spoken sentence — run node scripts/make-voice-recordings.js');
  for (const [name, text] of Object.entries(SPOKEN)) {
    const rec = manifest.recordings[name];
    assert.strictEqual(rec.text, text, name + ' was recorded from different wording — re-record it');
    const file = path.join(__dirname, '..', 'public', 'audio', rec.file);
    assert.ok(fs.existsSync(file), rec.file + ' is committed');
    const bytes = fs.readFileSync(file);
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), rec.sha256, rec.file + ' unchanged');
    assert.ok(bytes.length < 100 * 1024, rec.file + ' is small enough to load quickly on a call');
  }
  assert.strictEqual(manifest.voice.id, 'Xb7hH8MSUJpSbSDYk0k2', 'Alice');
  assert.strictEqual(manifest.model, 'eleven_multilingual_v2');
  assert.strictEqual(SPOKEN['missed-call-off'], 'Sorry we missed you. Steven will call you back.');
  assert.strictEqual(SPOKEN['missed-call-on'], "Sorry we missed you. We've just sent you a text.");
});

test('the audio URL follows the host Twilio called, or PUBLIC_BASE_URL', async () => {
  const { audioUrl } = require('../lib/voice-audio.js');
  const file = RECORDINGS.greeting.file;
  assert.strictEqual(audioUrl(fakeReq('/api/twilio/voice', {}), 'greeting'), BASE + '/audio/' + file);
  await withEnv({ PUBLIC_BASE_URL: 'https://signal.example.test' }, async () => {
    assert.strictEqual(audioUrl(fakeReq('/api/twilio/voice', {}), 'greeting'),
      'https://signal.example.test/audio/' + file);
  });
  assert.throws(() => audioUrl(fakeReq('/api/twilio/voice', {}), 'nope'), /no recording called nope/);
});
