'use strict';

/* Everything the ColdenJames site says, in one file.

   Change the wording, the email, the address or the phone number here and
   run `npm run site:build`. Nothing else holds copy. */

/* The business number, in the form people dial it. Set it to '' and the
   phone line, the texting line under it and the prospect page's Text me /
   Call me buttons all disappear. Then run: npm run site:build */
const PHONE = '(318) 666-6445';

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

/* The words a caller hears and is sent come from lib/texting-copy.js, which
   the Twilio routes read too, so this site can only ever quote what the
   phone actually says. */
const COPY = require('../lib/texting-copy.js');

const SETUP = {
  title: 'Set up your missed-call text',
  intro: 'This takes about two minutes. You only do it once. ' +
         'Start by tapping your phone company below.',
  pickLabel: 'Who is your phone company?',
  numberFallback: '[your ColdenJames number]',
  testHeading: 'Now test it',
  testLine: "Call your own number from another phone and don't answer. " +
            'Within a minute, that phone should get a text from your business.',
  testFail: "No text after a couple of minutes? Text Steven. Don't keep " +
            'trying codes — a wrong one can send every call away from your phone.',
  offHeading: 'Turning it off',
  offLine: 'Whenever you want, this puts your phone back exactly as it was. ' +
           'Your calls stop coming to us and go straight to your own voicemail again.',
  notSureHeading: "Not sure which one you're on?",
  notSureLine: "It's printed on your phone bill, or text Steven.",
  unconfirmed: "Text Steven and he'll walk you through it.",
  unconfirmedWhy: 'Your carrier does not publish steps for this, and guessing ' +
                  'could send every call away from your phone instead of only the ones you miss.',
  dialLabel: 'Tap to dial',
  warnAlways: 'Do not pick the option that forwards every call. ' +
              'You want the one for calls you do not answer.'
};

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

  /* Shown directly under the phone line, and only when there is one. The
     wording is what the carriers look for when they review business
     texting: what the texts are, how many, rates, STOP and HELP. */
  smsLine: 'Call or text ' + PHONE + ". If I miss your call, you'll get one " +
           "text back so you know I'll return it. Message and data rates may " +
           'apply. Reply STOP to opt out, HELP for help.',

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
        'One text per missed call, at most one per caller in any 24 hours. ' +
        'Message and data rates may apply. Reply ' +
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
      /* What the carriers check for when they review a texting program.
         **word** renders bold on the page; STOP and HELP are meant to stand
         out. */
      heading: 'Text messages (SMS)',
      paragraphs: [
        '**Program name:** ColdenJames missed-call text.',
        '**What it is:** when someone calls a ColdenJames business number ' +
        'and the call is not answered, the caller receives one text message ' +
        'letting them know the call will be returned. Replies to that text ' +
        'are passed to the business owner.',
        '**Message frequency:** one text per missed call, at most one per ' +
        'caller in any 24 hours. Recurring messages only if you reply.',
        'Message and data rates may apply.',
        '**Support:** ' + BUSINESS.email + ' or ' + PHONE + '.',
        'Reply **STOP** to stop receiving messages. Reply **HELP** for help.',
        '**What callers hear:** before a call rings through, a recorded ' +
        'message says: "' + COPY.VOICE_DISCLOSURE + '" Staying on the line ' +
        'after it is how a caller agrees to the one text. The whole call ' +
        'flow is at ' + BUSINESS.domain + '/sms.',
        'Carriers are not liable for delayed or undelivered messages.',
        'Mobile information is not shared with third parties or affiliates ' +
        'for marketing or promotional purposes.'
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

/* The public page that shows a caller's whole journey, for anyone — a
   caller, or a carrier reviewing the texting program — who wants to see
   exactly what happens and what is said. Every quoted line is the real
   one, read from the same place the phone reads it.

   The STOP and HELP replies are Twilio's, not ours: they are the defaults
   on the Messaging Service's registered campaign, read from the Twilio API
   in September 2026. If they are ever changed in Twilio, change them here. */
const STOP_REPLY =
  'You have successfully been unsubscribed. You will not receive any more ' +
  'messages from this number. Reply START to resubscribe.';
const HELP_REPLY = 'Reply STOP to unsubscribe. Msg&Data Rates May Apply.';

const SMS_PAGE = {
  title: 'Text messages from ColdenJames',
  intro:
    'ColdenJames texts one kind of person: someone who has just called a ' +
    'ColdenJames business number and not got through. This page shows ' +
    'every step of that, with the exact words used at each one.',
  steps: [
    {
      heading: 'You find the number',
      body: 'The number, ' + PHONE + ', is published in two places, and ' +
            'each one says beside it what happens if your call is missed.',
      quotes: [
        { label: 'On the homepage, ' + BUSINESS.domain + ':', text: HOME.smsLine },
        { label: 'On letters ColdenJames mails to local trade businesses, ' +
                 'printed under the number:', text: COPY.LETTER_SMS_LINE }
      ]
    },
    {
      heading: 'You call, and hear this first',
      body: 'When the call connects, before it rings through, you hear a ' +
            'recorded message:',
      quotes: [{ text: COPY.VOICE_DISCLOSURE }],
      after: 'Staying on the line after this message is how you agree to ' +
             'get a text back. If you would rather not, hang up and nothing ' +
             'is sent.'
    },
    {
      heading: "If the call isn't answered, you get one text",
      body: 'It goes to the number you called from, and nowhere else:',
      quotes: [{ text: COPY.MISSED_CALL_TEXT }]
    },
    {
      heading: 'If you reply, Steven gets it',
      body: 'Replies are passed to Steven, who may answer you by text.'
    },
    {
      heading: 'How often',
      body: 'One automated text per missed call, at most one per caller in ' +
            'any 24 hours, plus replies in conversations you start. Message ' +
            'and data rates may apply.'
    },
    {
      heading: 'Stopping, and getting help',
      body: 'Reply **STOP** at any time and you will get no more texts. ' +
            'Reply **HELP** for help. These are the replies you get back:',
      quotes: [
        { label: 'To STOP:', text: STOP_REPLY },
        { label: 'To HELP:', text: HELP_REPLY }
      ]
    },
    {
      heading: 'What we never do',
      body: 'Numbers are never taken from lists, bought, or shared for ' +
            'marketing, and ColdenJames sends no marketing texts. The only ' +
            'person who gets a text is someone who has just called.'
    }
  ],
  links: [
    { label: 'Terms of Use', href: '/terms' },
    { label: 'Privacy Policy', href: '/privacy' }
  ],
  support: 'Questions: ' + BUSINESS.email + ' or ' + PHONE + '.'
};

module.exports = {
  BUSINESS, HOME, PRIVACY, TERMS, UPDATED, DRAFT_NOTE, NOT_FOUND, SETUP, SMS_PAGE,
  STOP_REPLY, HELP_REPLY,
  GOOGLE_PRIVACY, GOOGLE_MAPS_TERMS, CARRIER_SENTENCE
};
