'use strict';

/* Records every sentence a caller hears, in the ColdenJames voice.

   The words come from lib/texting-copy.js and nowhere else. Each recording
   is written to public/audio/<name>-<hash>.mp3, where the hash is taken from
   the text, the voice and the model: change the wording and the file gets a
   new name, so Twilio — which caches what it plays by URL — can never play
   the old sentence. public/audio/voice.json maps each name to its file and
   records the exact text it was made from; the Twilio routes read that map,
   and a test checks it still matches the copy.

   Run:  node scripts/make-voice-recordings.js
   Needs ELEVENLABS_API_KEY in finder/.env. Only re-records what changed. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SPOKEN } = require('../lib/texting-copy.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'audio');
const MANIFEST = path.join(OUT, 'voice.json');

/* Alice: British, clear, professional. Chosen from four samples. */
const VOICE = { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' };
const MODEL = 'eleven_multilingual_v2';
/* 22.05kHz mono at 32kbps: telephone audio is 8kHz, so anything richer is
   bytes the caller waits for and never hears. */
const FORMAT = 'mp3_22050_32';

function apiKey() {
  const env = path.join(ROOT, 'finder', '.env');
  const line = fs.existsSync(env) &&
    fs.readFileSync(env, 'utf8').split('\n').find(l => l.startsWith('ELEVENLABS_API_KEY='));
  if (!line) throw new Error('ELEVENLABS_API_KEY is not set in finder/.env');
  return line.slice('ELEVENLABS_API_KEY='.length).trim();
}

const fileFor = (name, text) => name + '-' +
  crypto.createHash('sha256').update([VOICE.id, MODEL, FORMAT, text].join('\n')).digest('hex').slice(0, 10) + '.mp3';

async function record(key, text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL })
  });
  if (!res.ok) throw new Error('ElevenLabs refused (HTTP ' + res.status + '): ' + (await res.text()).slice(0, 200));
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const before = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { recordings: {} };
  const recordings = {};
  let key = null;
  let charges = 0;

  for (const [name, text] of Object.entries(SPOKEN)) {
    const file = fileFor(name, text);
    const target = path.join(OUT, file);
    if (!fs.existsSync(target)) {
      key = key || apiKey();
      fs.writeFileSync(target, await record(key, text));
      charges += text.length;
      console.log('recorded ' + file);
    } else {
      console.log('unchanged ' + file);
    }
    const bytes = fs.readFileSync(target);
    recordings[name] = { file, text, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }

  /* Files for wording that no longer exists are removed, so the folder only
     ever holds what the phone can play. */
  for (const old of Object.values(before.recordings || {})) {
    if (!Object.values(recordings).some(r => r.file === old.file)) {
      fs.rmSync(path.join(OUT, old.file), { force: true });
      console.log('removed ' + old.file);
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify({
    voice: VOICE, model: MODEL, format: FORMAT, recordings
  }, null, 2) + '\n');
  console.log('wrote public/audio/voice.json · ' + charges + ' characters charged');
}

main().catch(err => { console.error(err.message); process.exit(1); });
