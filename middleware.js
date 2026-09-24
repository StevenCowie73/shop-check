import { next, rewrite } from '@vercel/edge';
import NOT_FOUND_PAGE, { robotsTxt, sitemapXml } from './site/notfound-page.js';

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
  /* everything except /api/..., Vercel's internals, and the favicon */
  matcher: ['/((?!api/|_vercel/|favicon\\.ico).*)']
};

const SITE_HOSTS = new Set(['coldenjames.com', 'www.coldenjames.com']);
const CANONICAL = 'coldenjames.com';

/* The only three pages that exist, and the only three search engines may
   index. Everything else on this host — the /coldenjames/*.html files by
   their real paths, and /p/ which is not built yet — is a 404. */
const PAGES = {
  '/': '/coldenjames/index.html',
  '/privacy': '/coldenjames/privacy.html',
  '/privacy/': '/coldenjames/privacy.html',
  '/terms': '/coldenjames/terms.html',
  '/terms/': '/coldenjames/terms.html'
};

/* The setup page is for one client at a time, reached from a link Steven
   texts them. It is a real page but it is nobody's search result, so it is
   served like the others and then told to stay out of the index. */
const PRIVATE_PAGES = {
  '/setup': '/coldenjames/setup.html',
  '/setup/': '/coldenjames/setup.html'
};

const INDEXABLE = 'index, follow';
const HIDDEN = 'noindex, nofollow';

const TEXT_FILES = {
  '/robots.txt': ['text/plain; charset=utf-8', robotsTxt],
  '/sitemap.xml': ['application/xml; charset=utf-8', sitemapXml]
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

  /* robots.txt and the sitemap exist on this host and nowhere else. */
  const textFile = TEXT_FILES[url.pathname];
  if (textFile) {
    return new Response(textFile[1], {
      status: 200,
      headers: { 'Content-Type': textFile[0], 'X-Robots-Tag': HIDDEN }
    });
  }

  const hidden = PRIVATE_PAGES[url.pathname];
  if (hidden) {
    return rewrite(new URL(hidden, url), { headers: { 'X-Robots-Tag': HIDDEN } });
  }

  /* A prospect's own page. The reference code is the whole address; the
     record behind it decides what the page says. Rendered by a function
     rather than a file, so a database can replace the demo record without
     anything here changing. */
  const prospect = /^\/p\/([A-Za-z0-9]{4,24})\/?$/.exec(url.pathname);
  if (prospect) {
    const to = new URL('/api/prospect', url);
    to.searchParams.set('ref', prospect[1]);
    const channel = url.searchParams.get('c');
    if (channel) to.searchParams.set('c', channel);
    return rewrite(to, { headers: { 'X-Robots-Tag': HIDDEN } });
  }

  const target = PAGES[url.pathname];
  if (target) {
    /* vercel.json withholds the noindex header from this host, so saying
       so here is what actually makes these three pages indexable. */
    return rewrite(new URL(target, url), { headers: { 'X-Robots-Tag': INDEXABLE } });
  }

  /* A real 404, not the homepage wearing a wrong URL. A soft 404 teaches
     search engines that every mistyped link is a valid page. */
  return new Response(NOT_FOUND_PAGE, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': HIDDEN,
      'Cache-Control': 'no-store'
    }
  });
}
