import {
  h, link, badge, button, card, empty, table, formatDate, formatDateTime, titleCase,
  toast, confirmDialog, countdown,
} from '../ui.js';
import {
  store, update, updateQuietly, id, guides, guideById, institutions, institutionById, matchedGuides,
  conversationWith, openTrustCase, questions, suspendGuide, toPublicProfile,
} from '../store.js';
import {
  scanMessage, flagSummary, canGuideSendMessages, isGuideDiscoverable, guideBlockReason,
  GUIDE_TOPIC_LABELS, GUIDE_EVIDENCE_LABELS, daysUntil,
} from '../engine.js';
import { safetyBanner, guideStateBadge, topicChips, sampleChip } from './components.js';

/**
 * The directory.
 *
 * Unverified guides do not appear at all — not greyed out, not "pending", not
 * present. `isGuideDiscoverable` is the platform's own predicate, so a state
 * added later is excluded by default rather than leaking into the list.
 */
export function guidesView(route) {
  const institutionFilter = route.query.institution ?? '';
  const roster = institutions()
    .filter((one) => institutionFilter === '' || one.id === institutionFilter)
    .flatMap((institution) => matchedGuides(institution.id));

  const hidden = guides().filter((guide) => !isGuideDiscoverable(guide.state));

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Verified student guides'),
    h('p', { class: 'muted' },
      'Current students at the university you are applying to. Every one of them is verified against evidence ',
      'that expires, and none of them can take money from you.'),
    safetyBanner(),

    h('div', { class: 'row' },
      h('label', { class: 'small muted', for: 'institution' }, 'University'),
      h('select', {
        id: 'institution', style: 'width:auto',
        onChange: (event) => {
          location.hash = event.target.value === '' ? '#/guides' : `#/guides?institution=${event.target.value}`;
        },
      },
        h('option', { value: '', selected: institutionFilter === '' }, 'All universities'),
        institutions().map((one) =>
          h('option', { value: one.id, selected: institutionFilter === one.id }, one.displayName)))),

    roster.length === 0
      ? empty('No verified guide is available at that university yet.')
      : h('div', { class: 'grid grid-2' }, roster.map(guideCard)),

    hidden.length > 0
      ? h('p', { class: 'small muted' },
          `${hidden.length} guide profile${hidden.length === 1 ? ' is' : 's are'} withheld from this directory `
          + '(verification pending, expired or suspended). A profile is not shown until the evidence is current.')
      : null);
}

function guideCard(match) {
  const profile = match.profile;
  return h('article', { class: 'card stack-sm' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h3', {}, link(`/guides/${profile.id}`, profile.displayName)),
        h('p', { class: 'small muted' },
          `${profile.programName} · year ${profile.yearOfStudy} · ${profile.campusName ?? ''}`)),
      h('div', { class: 'chips' },
        guideStateBadge(profile),
        profile.online ? badge('Online', 'info') : null)),
    h('p', { class: 'small muted' }, profile.bio),
    topicChips(profile.topics),
    h('div', { class: 'facts small' },
      h('span', {}, 'Speaks ', h('b', {}, profile.languages.join(', ').toUpperCase())),
      profile.responseTimeHours === null
        ? null
        : h('span', {}, 'Usually replies in ', h('b', {}, `${profile.responseTimeHours}h`)),
      profile.universityEndorsed ? badge('University-endorsed role', 'brand') : null),
    h('p', { class: 'small', style: 'color:var(--ink-600)' }, match.matchReason),
    h('div', { class: 'row' },
      link(`/messages?guide=${profile.id}`, 'Message', { class: 'btn btn-primary btn-sm' }),
      link(`/guides/${profile.id}`, 'Profile', { class: 'btn btn-secondary btn-sm' })));
}

// ---------------------------------------------------------------------------
// Guide profile
// ---------------------------------------------------------------------------

export function guideView(guideId) {
  const guide = guideById(guideId);
  if (guide === null) {
    return h('div', { class: 'wrap stack' }, h('h1', {}, 'Guide not found'), link('/guides', 'Back to the directory'));
  }
  const profile = toPublicProfile(guide);
  const institution = institutionById(guide.institutionId);
  const answers = questions().filter((one) => one.guideId === guide.id);
  const blocked = guideBlockReason(profile.state);

  return h('div', { class: 'wrap stack' },
    h('nav', { class: 'small muted' }, link('/guides', 'Student guides'), ' / ', profile.displayName),
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h1', {}, profile.displayName),
        h('p', { class: 'muted' },
          profile.programName, ' · ', link(`/institutions/${institution.id}`, institution.displayName),
          profile.campusName ? ` · ${profile.campusName}` : '')),
      h('div', { class: 'chips' }, guideStateBadge(profile), sampleChip())),

    blocked !== null
      ? h('p', { class: 'notice notice-danger' },
          blocked, ' ',
          store.state.guideSuspensions[guide.id]?.reason ?? guide.suspensionReason ?? '')
      : null,

    safetyBanner(),

    h('div', { class: 'split wide' },
      h('div', { class: 'stack' },
        card(h('h2', {}, 'About'), h('p', { class: 'muted', style: 'margin-top:8px' }, profile.bio),
          h('h3', { style: 'margin-top:16px' }, 'Can talk about'),
          h('div', { style: 'margin-top:8px' }, topicChips(profile.topics)),
          h('p', { class: 'small muted', style: 'margin-top:14px' },
            'Not in scope for any guide: immigration or legal advice, admission decisions, or anything involving money.')),

        answers.length > 0
          ? card(h('h2', {}, 'Answers in the public Q&A'),
              h('div', { class: 'stack', style: 'margin-top:10px' }, answers.map((answer) =>
                h('div', { class: 'stack-sm' },
                  h('strong', {}, answer.question),
                  h('p', { class: 'small muted' }, answer.answer),
                  h('p', { class: 'small muted' }, `Approved after moderation · ${formatDate(answer.answeredAt)}`)))))
          : null,

        bookingPanel(guide, profile)),

      h('aside', { class: 'stack' },
        card(h('h3', {}, 'Verification'),
          h('div', { class: 'stack-sm', style: 'margin-top:10px' },
            guide.evidence.length === 0
              ? h('p', { class: 'small muted' }, 'No current-student evidence on file.')
              : guide.evidence.map((evidence) => h('p', { class: 'small' },
                  h('strong', {}, GUIDE_EVIDENCE_LABELS[evidence.type] ?? evidence.type),
                  h('span', { class: 'small muted', style: 'display:block' },
                    `Confirmed ${formatDate(evidence.verifiedAt)} by ${evidence.reviewer} · expires ${formatDate(evidence.expiresAt)}`))),
            profile.expiresAt
              ? h('p', { class: 'small muted' },
                  `Reverification due ${countdown(profile.expiresAt)}. Expiry suspends messaging automatically — no human step.`)
              : null),
          h('p', { class: 'small muted', style: 'margin-top:10px' },
            'The evidence itself is never shown publicly. What you see is that it exists, who checked it and when it runs out.')),

        card(h('h3', {}, 'Trust score'),
          h('p', { class: 'money', style: 'margin-top:6px' }, String(profile.trustScore)),
          h('p', { class: 'small muted' },
            'A tie-break between guides who matched you equally well, and nothing more. It is never a substitute for verification.')),

        card(h('h3', {}, 'Report'),
          h('p', { class: 'small muted', style: 'margin-top:8px' },
            'Anyone can report a guide, a message, an offer or an institutional claim. A report opens an auditable trust case.'),
          button('Report this guide', () => reportDialog('guide', guide.id, profile.displayName), 'secondary')))));
}

function bookingPanel(guide, profile) {
  const slots = nextSlots(guide.openSlots);
  const booked = store.state.sessions.filter((one) => one.guideId === guide.id);

  return card(
    h('h2', {}, 'Book a session'),
    h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
      'Sessions are scheduled and run through Modex. There is no payment path to a guide: they are rewarded by Modex ',
      'after the session, and the reward has no connection to whether you are admitted.'),
    slots.length === 0
      ? h('p', { class: 'notice notice-warning small' }, 'No free slots in the booking window. Send a message instead.')
      : h('div', { class: 'stack-sm' }, slots.map((slot) =>
          h('div', { class: 'row-between' },
            h('span', {}, formatDateTime(slot), h('span', { class: 'small muted' }, ` · your timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`)),
            button('Book', () => {
              update((state) => state.sessions.push({
                id: id('session'), guideId: guide.id, at: slot.toISOString(),
                channel: 'platform_audio', status: 'scheduled', rewardState: 'pending',
              }));
              toast('Session booked. It appears in your dashboard and the guide is notified.');
            }, 'secondary', { class: 'btn btn-secondary btn-sm' })))),
    booked.length > 0
      ? h('div', { class: 'stack-sm', style: 'margin-top:14px' },
          h('strong', { class: 'small' }, 'Your sessions with this guide'),
          booked.map((session) => h('p', { class: 'small muted' },
            `${formatDateTime(session.at)} · ${titleCase(session.status)} · reward ${session.rewardState} (never tied to an admission outcome)`)))
      : null);
}

function nextSlots(count) {
  const slots = [];
  const base = new Date();
  base.setMinutes(0, 0, 0);
  for (let index = 1; index <= count; index += 1) {
    slots.push(new Date(base.getTime() + index * 26 * 3_600_000));
  }
  return slots;
}

async function reportDialog(targetType, targetId, label) {
  const reason = h('textarea', { placeholder: 'What happened?', 'aria-label': 'What happened' });
  const confirmed = await confirmDialog({
    title: `Report ${label}`,
    body: h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' },
        'The report opens a trust case with an auditable record. Evidence is preserved before any moderation action, '
        + 'so nothing you are reporting can be edited away.'),
      reason),
    confirmLabel: 'Send the report',
  });
  if (!confirmed) return;
  const record = openTrustCase({
    type: 'user_report',
    targetType,
    targetId,
    reporterId: 'student-demo',
    severity: 'medium',
    summary: reason.value.trim() === '' ? 'Reported by a student, no detail given.' : reason.value.trim(),
    evidence: [`${targetType}:${targetId}`],
  });
  toast(`Trust case ${record.id} opened. Modex Trust reviews it; you will not be left to argue with the person you reported.`);
}

// ---------------------------------------------------------------------------
// Messages — the anti-scam pipeline, running for real
// ---------------------------------------------------------------------------

export function messagesView(query) {
  if (query.guide) ensureConversation(query.guide);
  const conversations = store.state.conversations;
  if (conversations.length === 0) {
    return h('div', { class: 'wrap stack' },
      h('h1', {}, 'Messages'),
      empty('No conversations yet.', link('/guides', 'Find a guide', { class: 'btn btn-primary btn-sm' })));
  }

  const activeId = query.thread ?? conversations[0].id;
  const active = conversations.find((one) => one.id === activeId) ?? conversations[0];

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Messages'),
    safetyBanner(),
    h('div', { class: 'chat' },
      h('div', { class: 'thread-list', role: 'tablist', 'aria-label': 'Conversations' },
        conversations.map((conversation) => {
          const guide = guideById(conversation.guideId);
          return h('button', {
            type: 'button',
            role: 'tab',
            'aria-current': conversation.id === active.id ? 'true' : null,
            onClick: () => { location.hash = `#/messages?thread=${conversation.id}`; },
          },
            h('strong', { class: 'small' }, guide?.displayName ?? 'Guide'),
            h('span', { class: 'small muted', style: 'display:block' },
              conversation.messages.at(-1)?.body.slice(0, 46) ?? 'No messages yet'));
        })),
      threadPanel(active)));
}

function ensureConversation(guideId) {
  if (conversationWith(guideId) !== null) return;
  const guide = guideById(guideId);
  if (guide === null) return;
  updateQuietly((state) => state.conversations.unshift({
    id: id('conv'),
    guideId,
    contextType: 'institution',
    contextId: guide.institutionId,
    status: 'open',
    createdAt: new Date().toISOString(),
    messages: [],
  }));
}

function threadPanel(conversation) {
  const guide = guideById(conversation.guideId);
  const profile = guide === null ? null : toPublicProfile(guide);
  const guideCanSend = profile !== null && canGuideSendMessages(profile.state);

  const list = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  for (const message of conversation.messages) list.append(messageNode(message, profile));
  if (!guideCanSend) {
    list.append(h('p', { class: 'bubble system' },
      guideBlockReason(profile?.state ?? 'suspended')
      ?? 'This guide can no longer send messages.'));
  }

  const input = h('textarea', {
    placeholder: 'Ask about accommodation, the coursework, the city…',
    'aria-label': 'Message',
    rows: '2',
    onKeydown: (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send('student'); }
    },
  });

  const asGuide = h('input', { type: 'checkbox', id: 'as-guide' });

  function send(role) {
    const body = input.value.trim();
    if (body === '') return;
    input.value = '';

    // The platform's own scanner, on the send path, before the message is
    // stored — so a flagged message is stored already flagged.
    const assessment = scanMessage(body, role);
    const message = {
      id: id('msg'),
      senderRole: role,
      body,
      at: new Date().toISOString(),
      findings: assessment.findings,
      severity: assessment.severity,
      action: assessment.action,
      summary: flagSummary(assessment),
    };

    update((state) => {
      const target = state.conversations.find((one) => one.id === conversation.id);
      target.messages.push(message);
    });

    if (assessment.action === 'warn_and_open_case') {
      openTrustCase({
        type: assessment.findings[0].signal,
        targetType: role === 'guide' ? 'guide' : 'message',
        targetId: role === 'guide' ? conversation.guideId : message.id,
        reporterId: 'system',
        severity: assessment.severity,
        summary: `Automatic: ${assessment.findings.map((finding) => finding.signal).join(', ')} in a message.`,
        evidence: assessment.findings.flatMap((finding) => finding.matches),
      });
    }

    // A guide whose message scores critical is suspended by the pipeline, not
    // by somebody noticing. The evidence is already preserved above.
    if (role === 'guide' && (assessment.severity === 'critical')) {
      suspendGuide(conversation.guideId,
        `Automatic suspension: ${assessment.findings.map((finding) => finding.signal).join(', ')}.`);
      toast('The guide was suspended automatically and a trust case is open.');
    } else if (role === 'student' && guideCanSend && assessment.action === 'allow') {
      setTimeout(() => reply(conversation.id), 1100);
    }
  }

  function reply(conversationId) {
    const canned = [
      'Good question. My own experience: the accommodation portal opens the week after you accept, and the postgraduate hall filled in about ten days last year.',
      'I would check the module handbook for that — it is published before you enrol and it is the only version that counts. Happy to tell you how the workload felt in practice.',
      'On cost: my monthly spend outside tuition was around £900, but that is one person’s experience, not a figure to plan a visa application around.',
      'I cannot advise on visas at all — that is the government’s call and I would be guessing. What I can describe is the order the university paperwork arrived in.',
    ];
    const body = canned[Math.floor(Math.random() * canned.length)];
    const assessment = scanMessage(body, 'guide');
    update((state) => {
      const target = state.conversations.find((one) => one.id === conversationId);
      if (target === undefined) return;
      target.messages.push({
        id: id('msg'), senderRole: 'guide', body, at: new Date().toISOString(),
        findings: assessment.findings, severity: assessment.severity, summary: flagSummary(assessment),
      });
    });
  }

  const composer = h('div', { class: 'composer' },
    h('div', { style: 'flex:1' }, input),
    button('Send', () => send(asGuide.checked ? 'guide' : 'student'), 'primary'));

  return h('div', { class: 'panel' },
    h('div', { style: 'padding:12px 16px;border-bottom:1px solid var(--border)' },
      h('div', { class: 'row-between' },
        h('div', { class: 'stack-sm' },
          h('strong', {}, profile?.displayName ?? 'Guide'),
          h('span', { class: 'small muted' }, `${profile?.programName ?? ''} · ${profile?.institutionName ?? ''}`)),
        h('div', { class: 'row' },
          profile ? guideStateBadge(profile) : null,
          button('Report', () => reportDialog('conversation', conversation.id, profile?.displayName ?? 'this conversation'),
            'ghost', { class: 'btn btn-ghost btn-sm' }),
          button('Block', async () => {
            const yes = await confirmDialog({
              title: 'Block this guide?',
              body: 'They can no longer message you. Your existing messages are kept as evidence.',
              confirmLabel: 'Block',
            });
            if (yes) {
              update((state) => {
                const target = state.conversations.find((one) => one.id === conversation.id);
                target.status = 'blocked';
              });
              toast('Blocked. The conversation stays on file for Modex Trust.');
            }
          }, 'ghost', { class: 'btn btn-ghost btn-sm' }))),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'A guide’s phone number, email and off-platform handles are not in any response this page can request. ',
        'There is nowhere in the projection to put one.')),
    list,
    h('div', { style: 'padding:8px 12px;border-top:1px solid var(--border)' },
      h('label', { class: 'check small' }, asGuide,
        h('span', {}, 'Demo: send this as the ', h('strong', {}, 'guide'),
          ' — the scanner treats the same words differently depending on who is speaking. ',
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onClick: () => { input.value = 'No problem, just send the £2,000 deposit to my account and I will make sure you get in — 100% admission guaranteed.'; input.focus(); },
          }, 'Paste a scam attempt')))),
    composer);
}

function messageNode(message, profile) {
  const mine = message.senderRole === 'student';
  const bubble = h('div', { class: `bubble ${mine ? 'mine' : ''}` },
    h('p', {}, message.body),
    h('p', { class: 'meta' },
      mine ? 'You' : profile?.displayName ?? 'Guide', ' · ', formatDateTime(message.at),
      message.findings?.length ? ' · flagged' : ''));

  if (!message.findings || message.findings.length === 0) return bubble;

  // The interstitial sits ABOVE the message and the message is not deleted:
  // the student sees what was said and why it was flagged.
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'notice notice-warning small' },
      h('strong', {}, message.senderRole === 'guide' ? 'Modex flagged this message. ' : 'Careful. '),
      message.findings.map((finding) => finding.studentWarning).join(' '),
      h('span', { style: 'display:block;margin-top:6px' },
        message.findings.map((finding) => badge(titleCase(finding.signal), 'warning')),
        ' ',
        button('Report it', () => reportDialog('message', message.id, 'this message'), 'ghost',
          { class: 'btn btn-ghost btn-sm' }))),
    bubble);
}

// ---------------------------------------------------------------------------
// Public Q&A
// ---------------------------------------------------------------------------

export function questionsView() {
  const all = questions();
  const topics = [...new Set(all.map((one) => one.topic))];
  const search = h('input', { type: 'search', placeholder: 'Search the questions', 'aria-label': 'Search questions' });
  const results = h('div', { class: 'stack' });

  const render = (topic = '') => {
    const text = search.value.toLowerCase().trim();
    results.replaceChildren(...all
      .filter((one) => (topic === '' || one.topic === topic)
        && (text === '' || `${one.question} ${one.answer}`.toLowerCase().includes(text)))
      .map(answerCard));
  };

  search.addEventListener('input', () => render(current));
  let current = '';

  const chips = h('div', { class: 'chips' },
    h('button', { type: 'button', class: 'chip selected', onClick: () => { current = ''; render(); } }, 'All topics'),
    topics.map((topic) => h('button', {
      type: 'button', class: 'chip',
      onClick: () => { current = topic; render(topic); },
    }, GUIDE_TOPIC_LABELS[topic] ?? titleCase(topic))));

  render();

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Questions answered by students who are there'),
    h('p', { class: 'muted' },
      'Approved answers become searchable knowledge, with the guide’s attribution and their consent. ',
      'Answers are moderated before they appear; a guide who cannot answer says so.'),
    search, chips, results);
}

function answerCard(entry) {
  const guide = guideById(entry.guideId);
  return h('article', { class: 'card stack-sm' },
    h('h3', {}, entry.question),
    h('p', { class: 'muted' }, entry.answer),
    h('div', { class: 'row small muted' },
      guide ? link(`/guides/${guide.id}`, guide.displayName) : 'A verified guide',
      ' · ', GUIDE_TOPIC_LABELS[entry.topic] ?? titleCase(entry.topic),
      ' · ', formatDate(entry.answeredAt),
      badge('Moderated', 'success'),
      badge(`${entry.helpfulCount} found this useful`, 'neutral')));
}
