import { next, rewrite } from '@vercel/edge';

/* Two sites, one Vercel project, told apart by the host.

   coldenjames.com gets the public site. Every other host — signal.cowie.ai
   and the *.vercel.app deployment URLs — is left exactly as it was.

   This has to be middleware rather than a rewrite in vercel.json, because
   vercel.json rewrites are only consulted after the filesystem has been
   checked, and public/index.html already answers "/". A rewrite could never
   win that fight. Middleware runs first, so it can.

   The matcher below excludes /api entirely. Signal's lookup and the Twilio
   webhooks are never seen by this function, so nothing here can alter a
   request body, a header, or the URL a Twilio signature was computed over. */

export const config = {
  /* everything except /api/..., Vercel's internals, and static assets */
  matcher: ['/((?!api/|_vercel/|favicon\\.ico).*)']
};

const SITE_HOSTS = new Set(['coldenjames.com', 'www.coldenjames.com']);
const CANONICAL = 'coldenjames.com';

/* The three pages the site actually has. Anything else on this host falls
   through to the homepage rather than showing a Vercel 404. */
const PAGES = {
  '/': '/coldenjames/index.html',
  '/privacy': '/coldenjames/privacy.html',
  '/privacy/': '/coldenjames/privacy.html',
  '/terms': '/coldenjames/terms.html',
  '/terms/': '/coldenjames/terms.html'
};

export default function middleware(request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();

  if (!SITE_HOSTS.has(host)) return next();

  if (host !== CANONICAL) {
    url.host = CANONICAL;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 308);
  }

  const target = PAGES[url.pathname];
  if (target) return rewrite(new URL(target, url));

  /* /p/REF and anything else on this domain is not built yet. Send it to
     the homepage rather than leaving a dead end on a public site. */
  return rewrite(new URL(PAGES['/'], url));
}
