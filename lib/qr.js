'use strict';

/* The QR code on a printed letter.

   Everything here exists so that a code can never go out unreadable. A QR on
   a screen is cheap to fix; a QR on four hundred posted letters is not
   fixable at all, so qrPng refuses to hand back an image it has not just
   decoded itself. That check is the whole point of this file — the encoding
   is a library call.

   Raster, not vector, for the same reason: the bytes that get decoded are the
   bytes that get printed. An SVG would look better in the PDF and would mean
   testing something other than the artifact. */

const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

/* 720 pixels in a one-inch box is 720dpi, which is past anything a consumer
   printer resolves — the point is that scaling never loses a module edge. */
const SIZE = 720;

/* Q corrects about a quarter of the code, which is what a letter that has
   been folded into an envelope and unfolded on a tailgate needs. */
const LEVEL = 'Q';

/* Four modules of quiet zone, as the spec requires. Phone scanners are
   forgiving about it; printers with edge-to-edge margins are not. */
const MARGIN = 4;

const INK = '#1C1917';
const PAPER = '#FFFFFF';

/* Returns what the image actually says, or null if nothing could read it. */
function decode(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return found ? found.data : null;
}

/* A PNG of `text`, decoded before it is returned. */
async function qrPng(text, { size = SIZE, level = LEVEL, margin = MARGIN } = {}) {
  const value = String(text);
  if (!value) throw new Error('nothing to encode');

  const buffer = await QRCode.toBuffer(value, {
    type: 'png',
    errorCorrectionLevel: level,
    margin,
    width: size,
    color: { dark: INK + 'FF', light: PAPER + 'FF' }
  });

  const scanned = decode(buffer);
  if (scanned !== value) {
    throw new Error('the QR code does not scan back to what went in: wanted ' +
      JSON.stringify(value) + ', read ' + JSON.stringify(scanned));
  }
  return buffer;
}

/* The same image, ready to drop into an <img src>. */
async function qrDataUri(text, options) {
  const buffer = await qrPng(text, options);
  return 'data:image/png;base64,' + buffer.toString('base64');
}

module.exports = { qrPng, qrDataUri, decode, SIZE, LEVEL, MARGIN, INK, PAPER };
