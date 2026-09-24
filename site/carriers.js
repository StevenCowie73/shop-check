'use strict';

/* What each carrier's OWN support pages say about forwarding a call that
   nobody answers.

   Every entry is either taken from a page on the carrier's own domain, with
   the URL and the date it was read, or marked confirmed: false. Nothing here
   comes from memory, from a third-party "how to forward your calls" blog, or
   from a community forum post — those are where the widely repeated GSM
   codes come from, and not one carrier publishes them on its own pages.

   If a carrier is not confirmed the setup page does not guess. It tells the
   client to text Steven, who can find out with them on the phone.

   READ ON: 24 September 2026. Re-check before a big sign-up push; carriers
   move these pages and change these codes without telling anybody. */

const READ_ON = '24 September 2026';

const CARRIERS = [
  {
    id: 'att',
    name: 'AT&T',
    network: 'AT&T network',
    confirmed: true,
    /* AT&T publishes no dial code for this. Its own device tutorials use the
       phone's own call-forwarding menu, which is where the three conditional
       options live. */
    method: 'menu',
    steps: [
      'Open the Phone app.',
      'Tap the menu button — three dots, usually top right.',
      'Tap Settings, then Calling accounts. If you see two SIMs, pick the one with your business number.',
      'Tap Call forwarding.',
      'Tap When unanswered. Do NOT tap Always forward.',
      'Enter the number below, then tap Turn on.',
      'Go back and do the same for When busy and When unreachable.'
    ],
    offSteps: [
      'Open the Phone app.',
      'Tap the menu button, then Settings, then Calling accounts, then Call forwarding.',
      'Tap When unanswered, then Turn off. Do the same for When busy and When unreachable.'
    ],
    ringTime: 'not confirmed — AT&T does not publish a ring-time setting',
    cost: 'AT&T states forwarded calls are billed for the length of the call, and may add long distance or roaming charges. On some plans forwarded minutes are not counted against plan minutes.',
    caveat: 'These steps are the ones AT&T publishes for Android. AT&T does not publish conditional-forwarding steps for iPhone, so if you are on an iPhone, text Steven.',
    sources: [
      { label: 'AT&T device support — setting up call forwarding (Android)',
        url: 'https://www.att.com/device-support/article/141868/att/motivate-pro-2-5g/' },
      { label: 'AT&T Wireless — Call Forwarding for Wireless',
        url: 'https://www.att.com/support/article/wireless/KM1011513/' }
    ]
  },

  {
    id: 'verizon',
    name: 'Verizon',
    network: 'Verizon network',
    confirmed: true,
    method: 'code',
    /* Verizon's own FAQ: "To forward only the calls you don't answer on your
       mobile phone, call *71 + the 10-digit number." */
    code: '*71',
    codeNote: 'Dial *71 then your ColdenJames number, with no spaces, then press call.',
    steps: [
      'Open the Phone app, as if you were making a call.',
      'Dial the code below exactly — the star, 7, 1, then the number.',
      'Press call. The line will beep or read a short message, then end.',
      "That's it. Calls you don't answer now come to us."
    ],
    offSteps: [
      'Open the Phone app.',
      'Dial *73 and press call.',
      'Verizon turns call forwarding off.'
    ],
    offCode: '*73',
    ringTime: 'not confirmed — Verizon does not publish a ring-time setting',
    cost: 'Verizon states there is no monthly fee for Call Forwarding on most plans, that a fee may apply on certain older plans, and that you are billed for a forwarded call as if you had answered it.',
    caveat: 'Verizon states this will not forward to a number outside the United States, and that on an iPhone with Live Voicemail switched on it may not work until Live Voicemail is turned off.',
    sources: [
      { label: 'Verizon — Call Forwarding FAQs',
        url: 'https://www.verizon.com/support/call-forwarding-faqs/' }
    ]
  },

  {
    id: 'tmobile',
    name: 'T-Mobile',
    network: 'T-Mobile network',
    confirmed: true,
    method: 'menu',
    /* T-Mobile confirms the feature and publishes the off code, but sends you
       to a per-device tutorial for the steps, so the steps below are the
       generic Android menu path and are flagged as such. */
    steps: [
      'Open the Phone app.',
      'Tap the menu button — three dots, usually top right.',
      'Tap Settings, then Call forwarding.',
      'Choose the option for calls you do not answer. Do NOT choose the one that forwards all calls.',
      'Enter the number below and turn it on.',
      'Do the same for the busy and unreachable options if your phone lists them.'
    ],
    offSteps: [
      'Open the Phone app, as if you were making a call.',
      'Dial ##004# and press call.',
      'T-Mobile resets the busy, unreachable and no-reply forwarding on your line.'
    ],
    offCode: '##004#',
    ringTime: 'not confirmed — T-Mobile does not publish a ring-time setting',
    cost: 'not confirmed — T-Mobile does not state a charge for call forwarding on the page read',
    caveat: 'T-Mobile states you can only forward to a 10 or 11 digit number and not to an international number. T-Mobile sends you to a tutorial for your exact handset, so the menu wording may differ slightly from the steps above.',
    sources: [
      { label: 'T-Mobile — Calling services (call forwarding)',
        url: 'https://www.t-mobile.com/support/plans-features/calling-services' },
      { label: "T-Mobile — Can't call, dropped calls & other calling issues (##004# reset)",
        url: 'https://www.t-mobile.com/support/devices/device-troubleshooting/cant-call-dropped-calls-and-other-calling-issues' }
    ]
  },

  {
    id: 'straighttalk',
    name: 'Straight Talk',
    network: 'Runs on more than one network',
    confirmed: true,
    method: 'menu',
    steps: [
      'Open the Phone app.',
      'Tap the menu button — three dots.',
      'Tap Settings, then Supplementary services.',
      'Tap Call forwarding.',
      'Tap the option for calls you do not answer — not the one that forwards everything.',
      'Enter 1, then the number below, then tap Turn on.'
    ],
    offSteps: [
      'Open the Phone app, tap the menu button, then Settings.',
      'Tap Supplementary services, then Call forwarding.',
      'Tap the same option you turned on, then tap Turn off.'
    ],
    ringTime: 'not confirmed — Straight Talk does not publish a ring-time setting',
    cost: 'not confirmed — Straight Talk does not state a charge on the page read',
    caveat: "Straight Talk's own tutorial says call forwarding is only available in select areas and on select handsets, and it does not name the individual busy, unanswered and unreachable options. If the option for unanswered calls is not there, text Steven.",
    sources: [
      { label: 'Straight Talk — Call Forwarding tutorial (Samsung Galaxy S22)',
        url: 'https://support.straighttalk.com/tutorials/calls/call-forwarding/?device=samsung-galaxy-s22-5g-s901u1' }
    ]
  },

  /* ---- the ones we could not confirm ---- */

  {
    id: 'cricket',
    name: 'Cricket',
    network: 'AT&T network',
    confirmed: false,
    why: "Cricket's Available Features page lists Call Forwarding by name and says nothing else about it, and its Dialing Shortcuts page carries no forwarding codes at all. Nothing on cricketwireless.com states how to forward only unanswered calls.",
    sources: [
      { label: 'Cricket — Available Features',
        url: 'https://www.cricketwireless.com/support/plans-and-features/features' },
      { label: 'Cricket — Dialing Shortcuts',
        url: 'https://www.cricketwireless.com/support/using-my-phone/dialing-shortcuts' }
    ]
  },
  {
    id: 'metro',
    name: 'Metro by T-Mobile',
    network: 'T-Mobile network',
    confirmed: false,
    why: 'No page on metrobyt-mobile.com sets out call forwarding steps or codes. Every set of instructions found was on a third-party site, and several of those contradict each other about whether Metro charges a monthly fee for the feature.',
    sources: [
      { label: 'Metro by T-Mobile — Support home',
        url: 'https://www.metrobyt-mobile.com/support' }
    ]
  },
  {
    id: 'visible',
    name: 'Visible',
    network: 'Verizon network',
    confirmed: false,
    why: "Visible's own help pages do not cover call forwarding. Visible's community forum carries repeated reports that conditional forwarding codes are rejected on Visible lines, but forum posts are customers talking to each other, not Visible documentation, so this is not something to set up blind.",
    sources: [
      { label: 'Visible — Help',
        url: 'https://www.visible.com/help' }
    ]
  },
  {
    id: 'boost',
    name: 'Boost Mobile',
    network: 'Boost, AT&T or T-Mobile',
    confirmed: false,
    why: "Boost's device-help pages would not load when checked. What is indexed from them describes forwarding that stops the phone ringing at all, which is forwarding every call — the opposite of what we want. Nothing confirms Boost supports forwarding only unanswered calls.",
    sources: [
      { label: 'Boost Mobile — Support centre',
        url: 'https://help.boostmobile.com/' }
    ]
  },
  {
    id: 'other',
    name: 'Something else',
    network: '',
    confirmed: false,
    why: 'Every carrier is different, and a wrong code sends every call away from your phone instead of only the ones you miss.',
    sources: []
  }
];

module.exports = { CARRIERS, READ_ON };
