'use strict';

/* Everything the ColdenJames site says, in one file.

   Change the wording, the email, the address or the phone number here and
   run `npm run site:build`. Nothing else holds copy. */

/* ------------------------------------------------------------------
   >>> PHONE NUMBER PLACEHOLDER <<<
   Left empty on purpose. While it is empty the phone line does not
   appear on the site at all — better a missing line than a wrong number.
   Put the business number here in the form people dial it, for example
   (318) 555-0100, then run: npm run site:build
   ------------------------------------------------------------------ */
const PHONE = '';

const BUSINESS = {
  brand: 'ColdenJames',
  legal: 'COWIE.AI LLC',
  owner: 'Steven Cowie',
  email: 'steven@coldenjames.com',
  city: 'Bossier City',
  state: 'Louisiana',
  /* Add the mailing address here when the filing is done; it shows on the
     legal pages once it is not empty. */
  mailingAddress: '',
  phone: PHONE,
  domain: 'coldenjames.com'
};

const UPDATED = 'September 2026';

const NOT_FOUND = {
  title: 'Page not found',
  line: "This link doesn't match a page.",
  backLabel: 'Go to the homepage'
};

const HOME = {
  tagline: 'Missed-call texts, reviews and simple websites for local trades. ' +
           'Bossier City, Louisiana.',

  services: [
    {
      title: 'Missed-call text-back',
      body: 'When you are on a job and cannot get to the phone, the person ' +
            'who called gets a text straight away telling them you will get ' +
            'back to them. Most people who reach voicemail leave nothing and ' +
            'ring the next name on the list. This catches them before that.'
    },
    {
      title: 'Review requests',
      body: 'After a job is done, a short text asks the customer to leave a ' +
            'review, with the link already in it. No chasing, no awkward ask ' +
            'in person. Every customer whose job is done gets asked, once.'
    },
    {
      title: 'A simple website',
      body: 'One page that loads fast on a phone and says who you are, what ' +
            'you do, where you work and how to reach you. Registered in your ' +
            'name, not mine. If you ever leave, it goes with you.'
    }
  ],

  price: {
    headline: '$79 a month',
    points: [
      'First month free.',
      'No contract.',
      'Cancel with a text.',
      'Website registered in your name.'
    ]
  },

  reassurance:
    "This doesn't replace you or anyone who works for you, and it isn't a " +
    "robot pretending to be you on the phone. It handles the stuff that " +
    "falls through the cracks when you're busy.",

  setup:
    'I set the whole thing up. The one job on your side is changing a single ' +
    'setting on your phone, and I will talk you through it.'
};

const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const GOOGLE_MAPS_TERMS = 'https://maps.google.com/help/terms_maps/';

const DRAFT_NOTE = 'Plain-English draft — to be reviewed.';

/* The sentence below is required word for word by the mobile carriers who
   approve business texting. Do not reword it. */
const CARRIER_SENTENCE =
  'No mobile information will be shared with third parties or affiliates ' +
  'for marketing or promotional purposes. Text messaging originator opt-in ' +
  'data and consent will not be shared with any third parties.';

const PRIVACY = {
  title: 'Privacy Policy',
  intro:
    'This explains what ColdenJames collects, why, and what we do not do ' +
    'with it. If anything here is unclear, email ' + BUSINESS.email + ' and ' +
    'ask. It is a short policy because we collect very little.',
  sections: [
    {
      heading: 'What we collect',
      paragraphs: [
        'From a business that hires us: the contact details you give us — ' +
        'your name, your business name, your phone number, your email ' +
        'address, and the address we send post to. You gave them to us on ' +
        'purpose and we use them to run your service and to talk to you.',

        'From people who call or text your business number: their phone ' +
        'number, and the content of texts they send. This is how the service ' +
        'works — we cannot text someone back without knowing their number. ' +
        'We pass their messages on to you and we keep them no longer than we ' +
        'need to run the service and keep records straight.',

        'From people who open one of our prospect pages: a reference code ' +
        'for the page, what happened on it, when, and a coarse idea of the ' +
        'device — phone or desktop. No name, no cookies, and we do not keep ' +
        'the IP address. We use it to know whether the page was opened.'
      ]
    },
    {
      heading: 'Texting',
      paragraphs: [
        'Automated texts go to one group of people only: those who have just ' +
        'called a business number we run. We do not buy lists, we do not send ' +
        'marketing texts, and we do not text anyone who has not just tried to ' +
        'reach that business.',
        'Message frequency varies. Message and data rates may apply. Reply ' +
        'STOP to any message to opt out, or HELP for help.',
        CARRIER_SENTENCE
      ]
    },
    {
      heading: 'Google Maps content',
      paragraphs: [
        'Our prospect pages show information about a business taken from ' +
        'Google Maps — things like the business name, address and reviews as ' +
        'Google publishes them. Your use of those features is subject to ' +
        "Google's Privacy Policy."
      ],
      links: [{ label: "Google Privacy Policy", href: GOOGLE_PRIVACY }]
    },
    {
      heading: 'Who else touches your data',
      paragraphs: [
        'We use a small number of ordinary suppliers to run the service: a ' +
        'website host, a telephony provider that carries the calls and texts, ' +
        'an email provider, and a printing and mailing service for letters. ' +
        'Each one sees only what it needs to do its job.',
        'We do not sell your information, and we do not hand it to anyone ' +
        'for their own marketing.'
      ]
    },
    {
      heading: 'Getting your data deleted',
      paragraphs: [
        'Email ' + BUSINESS.email + ' and ask. Tell us which business or ' +
        'phone number it concerns. We will delete what we hold, except ' +
        'anything we are required to keep for tax or legal records, and we ' +
        'will tell you what that was.'
      ]
    },
    {
      heading: 'Changes',
      paragraphs: [
        'If this policy changes we will update this page and change the date ' +
        'below. Last updated: ' + UPDATED + '.'
      ]
    }
  ]
};

const TERMS = {
  title: 'Terms of Use',
  intro:
    'These are the terms for the ColdenJames service and this website. ' +
    'Plain words on purpose.',
  sections: [
    {
      heading: 'The service',
      paragraphs: [
        'ColdenJames provides three things: a missed-call text-back on a ' +
        'phone number we set up for your business, text messages asking your ' +
        'customers for reviews, and a one-page website. We set it up and we ' +
        'keep it running.',
        'We are not a phone company. Calls and texts are carried by a ' +
        'third-party telephony provider, and delivery depends on their ' +
        'network and the recipient’s carrier.'
      ]
    },
    {
      heading: 'What it costs',
      paragraphs: [
        'The service is $79 a month. The first month is free. There is no ' +
        'contract and no minimum term.',
        'To cancel, send a text saying so. Cancellation takes effect at the ' +
        'end of the month you are in, and we will not bill you again.'
      ]
    },
    {
      heading: 'Your domain and your website',
      paragraphs: [
        'The domain name for your website is registered in your name. It is ' +
        'yours. If you stop using us, you keep it, and we will help you move ' +
        'it wherever you want to go.'
      ]
    },
    {
      heading: 'Acceptable use',
      paragraphs: [
        'The texting side of this service only ever replies to someone who ' +
        'has just contacted your business, or asks a customer of yours for a ' +
        'review after a job. It is not a marketing tool.',
        'You may not use it to send bulk texts, marketing messages, or ' +
        'messages to people who have not contacted you. You may not use it to ' +
        'send anything unlawful, misleading, or abusive. If you do, we will ' +
        'stop the service.'
      ]
    },
    {
      heading: 'What we are responsible for',
      paragraphs: [
        'We will take proper care running your service, but we cannot ' +
        'promise that every call connects, that every text arrives, or that ' +
        'the service is never interrupted. Networks fail and providers have ' +
        'outages.',
        'To the fullest extent the law allows, our liability to you for any ' +
        'claim connected with this service is limited to the amount you paid ' +
        'us in the three months before the claim arose. We are not liable for ' +
        'lost profits, lost business or indirect losses.'
      ]
    },
    {
      heading: 'Google Maps content',
      paragraphs: [
        'Parts of this site show Google Maps content. By using those features ' +
        'you agree to be bound by the Google Maps/Google Earth Additional ' +
        'Terms of Service and the Google Privacy Policy.'
      ],
      links: [
        { label: 'Google Maps/Google Earth Additional Terms of Service', href: GOOGLE_MAPS_TERMS },
        { label: 'Google Privacy Policy', href: GOOGLE_PRIVACY }
      ]
    },
    {
      heading: 'Which law applies',
      paragraphs: [
        'These terms are governed by the laws of the State of Louisiana. Any ' +
        'dispute will be handled in the courts of Louisiana.'
      ]
    },
    {
      heading: 'Changes',
      paragraphs: [
        'If these terms change we will update this page and change the date ' +
        'below. Last updated: ' + UPDATED + '.'
      ]
    }
  ]
};

module.exports = {
  BUSINESS, HOME, PRIVACY, TERMS, UPDATED, DRAFT_NOTE, NOT_FOUND,
  GOOGLE_PRIVACY, GOOGLE_MAPS_TERMS, CARRIER_SENTENCE
};
