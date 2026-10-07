import { useRef, useState, useEffect } from 'react';
import './styles.css';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const STEPS = ['Processing', 'Shipped', 'Out for Delivery', 'Delivered'];

const COPY = {
  en: {
    greeting: 'Hi, this is Aria from Aura Skincare. How can I help you today?',
    nudge: "Are you still there? I'm happy to help whenever you're ready.",
    bye: "I haven't heard anything, so I'll end the call here. Please call us again anytime. Take care!",
    fallback: 'Sorry, I ran into a problem. Could you please say that again?',
    stt: 'en-IN',
  },
  hi: {
    greeting: 'नमस्ते, मैं Aura Skincare से Aria बोल रही हूँ। मैं आपकी कैसे मदद कर सकती हूँ?',
    nudge: 'क्या आप लाइन पर हैं? जब आप तैयार हों, मैं मदद के लिए यहाँ हूँ।',
    bye: 'मुझे कुछ सुनाई नहीं दिया, इसलिए मैं कॉल यहीं समाप्त कर रही हूँ। कभी भी दोबारा कॉल कीजिए। धन्यवाद!',
    fallback: 'माफ़ कीजिए, कुछ समस्या हो गई। क्या आप दोबारा बता सकते हैं?',
    stt: 'hi-IN',
  },
};

const TRY = [
  'Where is ORD-101?',
  'Can I return ORD-102?',
  'Cancel ORD-103',
  'Check ORD-999',
  'Will I pay shipping on a ₹450 order?',
  'Book me a flight to Goa',
];

const STATE_LABEL = {
  idle: 'Ready when you are',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

const TOOL_LABEL = {
  get_order_details: 'Looked up order',
  check_return_eligibility: 'Checked return policy',
  cancel_order: 'Cancellation request',
  get_shipping_quote: 'Calculated shipping',
};

const toolOutcome = (o = {}) => {
  if (o.error) return 'not found';
  if (o.success === true) return 'done';
  if (o.success === false) return 'declined';
  if (o.eligible === true) return 'eligible';
  if (o.eligible === false) return 'not eligible';
  return '';
};

const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const sentence = (s = '') => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const FEMALE = /neerja|heera|kalpana|swara|veena|priya|lekha|aditi|raveena|google.*(हिन्दी|hindi)|female/i;
const MALE = /ravi|prabhat|hemant|madhur|rishi|kabir|male(?!.*female)/i;

const pickVoice = (code) => {
  const vs = window.speechSynthesis.getVoices();
  const lang = (v) => v.lang.replace('_', '-');
  const sameLang = vs.filter((v) => lang(v) === code);
  const anyIndia = vs.filter((v) => /-IN$/i.test(lang(v)));
  const pools = [sameLang, anyIndia, vs.filter((v) => lang(v).startsWith('en'))];
  for (const pool of pools) {
    const f = pool.find((v) => FEMALE.test(v.name) && !MALE.test(v.name));
    if (f) return f;
  }
  // No known female voice installed: take any non-male voice rather than a male one
  return sameLang.find((v) => !MALE.test(v.name)) || null;
};

const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Plays Aria's voice sentence by sentence. Each sentence is sent to /api/tts the moment it
// arrives (free Microsoft neural female voice), so audio is ready while the previous
// sentence is still playing. If the server voice fails, the browser voice is used instead.
function createSpeaker({ getLang, onStart }) {
  let gen = 0;
  let chain = Promise.resolve();
  let audio = null;

  const fetchAudio = async (text, lang) => {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
    if (!r.ok) throw new Error('tts');
    return URL.createObjectURL(await r.blob());
  };

  const playUrl = (url, myGen) =>
    new Promise((resolve) => {
      if (myGen !== gen) { URL.revokeObjectURL(url); return resolve(); }
      audio = new Audio(url);
      const end = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = end;
      audio.onerror = end;
      audio.play().catch(end);
    });

  const browserSpeak = (text, lang, myGen) =>
    new Promise((resolve) => {
      if (myGen !== gen || !window.speechSynthesis) return resolve();
      const code = COPY[lang].stt;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = pickVoice(code);
      u.lang = code;
      u.rate = 1.03;
      u.onend = resolve;
      u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });

  return {
    say(text) {
      const myGen = gen;
      const lang = getLang();
      const prepared = fetchAudio(text, lang).catch(() => null);
      chain = chain.then(async () => {
        const url = await prepared;
        if (myGen !== gen) { if (url) URL.revokeObjectURL(url); return; }
        onStart?.();
        if (url) await playUrl(url, myGen);
        else await browserSpeak(text, lang, myGen);
      });
    },
    // resolves true when everything queued has been spoken, false if cancelled meanwhile
    whenDone() {
      const myGen = gen;
      return chain.then(() => myGen === gen);
    },
    cancel() {
      gen++;
      chain = Promise.resolve();
      if (audio) { audio.pause(); audio = null; }
      window.speechSynthesis?.cancel();
    },
  };
}

function Orb({ status }) {
  return (
    <div className={`orb ${status}`} aria-hidden="true">
      <span className="ring r1" />
      <span className="ring r2" />
      <span className="ring r3" />
      <span className="core" />
    </div>
  );
}

function OrderCard({ order, focused }) {
  const cancelled = order.status === 'Cancelled';
  const at = STEPS.indexOf(order.status);
  return (
    <article className={`order ${focused ? 'focused' : ''}`}>
      <div className="order-head">
        <strong>{order.id}</strong>
        <span className={`pill ${cancelled ? 'bad' : order.status === 'Delivered' ? 'ok' : 'soft'}`}>{order.status}</span>
      </div>
      <p className="order-product">{order.product}</p>
      <p className="order-meta">
        {order.customer} &middot; ₹{order.value_inr}
      </p>
      {cancelled ? (
        <p className="order-cancelled">This order was cancelled during the call.</p>
      ) : (
        <div className="steps" role="img" aria-label={`Order status: ${order.status}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={`step ${i < at ? 'done' : ''} ${i === at ? 'now' : ''}`}>
              {s}
            </span>
          ))}
        </div>
      )}
      <p className="order-note">
        {order.courier ? `${order.courier} ${order.tracking_id}. ` : ''}
        {order.notes}
      </p>
    </article>
  );
}

export default function App() {
  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking
  const [log, setLog] = useState([]);
  const [interim, setInterim] = useState('');
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [lang, setLang] = useState('en');
  const [orders, setOrders] = useState([]);
  const [focusId, setFocusId] = useState(null);
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');

  const active = useRef(false);
  const busy = useRef(false);
  const logRef = useRef([]);
  const recRef = useRef(null);
  const turn = useRef(0);
  const abortRef = useRef(null);
  const speaker = useRef(null);
  const bottomRef = useRef(null);
  const langRef = useRef('en');
  const startRef = useRef(0);
  const silences = useRef(0);
  const nudges = useRef(0);

  const inCall = status !== 'idle';

  if (!speaker.current) {
    speaker.current = createSpeaker({ getLang: () => langRef.current, onStart: () => setStatus('speaking') });
  }

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    refreshOrders();
  }, []);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [log, interim, status]);
  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [inCall]);

  const refreshOrders = async () => {
    try {
      const r = await fetch('/api/orders');
      setOrders(await r.json());
    } catch { /* server offline */ }
  };

  const resetOrders = async () => {
    try { await fetch('/api/reset', { method: 'POST' }); } catch { /* ignore */ }
    setFocusId(null);
    refreshOrders();
  };

  const push = (role, text, extra = {}) => {
    logRef.current = [...logRef.current, { role, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ...extra }];
    setLog(logRef.current);
  };

  const speakThen = (text, next) => {
    const sp = speaker.current;
    sp.say(text);
    sp.whenDone().then((ok) => { if (ok && active.current) next?.(); });
  };

  const listen = () => {
    if (!active.current || !SR) return;
    setStatus('listening');
    setInterim('');
    const rec = new SR();
    rec.lang = COPY[langRef.current].stt;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setNotice('Microphone access is blocked. Allow it in the address bar, or type your message below.');
        endCall();
      } else if (e.error === 'audio-capture') {
        setNotice('No microphone found. You can still type your message below.');
      } else if (e.error === 'network') {
        setNotice('Speech recognition lost its connection. Check your internet, or type your message below.');
      }
    };
    rec.onend = () => {
      if (recRef.current !== rec || !active.current) return;
      const t = finalText.trim();
      if (t.length > 1) {
        silences.current = 0;
        nudges.current = 0;
        setNotice('');
        handleUser(t);
        return;
      }
      silences.current += 1;
      if (silences.current >= 3) {
        silences.current = 0;
        if (nudges.current < 2) {
          nudges.current += 1;
          const msg = COPY[langRef.current].nudge;
          push('agent', msg);
          speakThen(msg, listen);
        } else {
          const msg = COPY[langRef.current].bye;
          push('agent', msg);
          speakThen(msg, () => endCall());
        }
      } else {
        setTimeout(listen, 200);
      }
    };
    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  };

  const updateLast = (patch) => {
    const arr = logRef.current;
    logRef.current = [...arr.slice(0, -1), { ...arr[arr.length - 1], ...patch }];
    setLog(logRef.current);
  };

  const handleUser = async (text) => {
    if (busy.current) return;
    busy.current = true;
    const myTurn = ++turn.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setInterim('');
    push('user', text);
    setStatus('thinking');

    const sp = speaker.current;
    const t0 = performance.now();
    let reply = '';
    let tools = [];
    let latency = null;
    let started = false;

    const handle = (ev) => {
      if (ev.type === 'tool') {
        tools = [...tools, ev.tool];
        setFocusId(ev.tool.output?.order_id || null);
        refreshOrders();
        if (started) updateLast({ tools });
      } else if (ev.type === 'sentence') {
        reply = reply ? `${reply} ${ev.text}` : ev.text;
        sp.say(ev.text);
        if (!started) {
          started = true;
          latency = Math.round(performance.now() - t0);
          push('agent', reply, { tools, latency });
        } else {
          updateLast({ text: reply });
        }
      }
    };

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang: langRef.current,
          messages: logRef.current.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        }),
      });
      if (!res.ok || !res.body) throw new Error('bad response');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          if (myTurn !== turn.current) return; // interrupted or call ended
          try { handle(JSON.parse(line)); } catch { /* skip bad line */ }
        }
      }
    } catch {
      if (myTurn !== turn.current) return;
    }

    if (myTurn !== turn.current) return;
    busy.current = false;
    if (!active.current) return;

    if (!started) {
      reply = COPY[langRef.current].fallback;
      sp.say(reply);
      push('agent', reply, { tools, latency: Math.round(performance.now() - t0) });
    }
    const ok = await sp.whenDone();
    if (ok && active.current && myTurn === turn.current) listen();
  };

  const startCall = () => {
    if (!SR) return;
    logRef.current = [];
    setLog([]);
    setSummary(null);
    setNotice('');
    setFocusId(null);
    setElapsed(0);
    silences.current = 0;
    nudges.current = 0;
    busy.current = false;
    startRef.current = Date.now();
    active.current = true;
    const greeting = COPY[langRef.current].greeting;
    push('agent', greeting);
    speakThen(greeting, listen);
  };

  const endCall = async () => {
    if (!active.current) return;
    active.current = false;
    turn.current++;
    abortRef.current?.abort();
    busy.current = false;
    speaker.current.cancel();
    const r = recRef.current;
    recRef.current = null;
    r?.abort();
    setStatus('idle');
    setInterim('');
    const entries = logRef.current;
    const duration = Math.floor((Date.now() - startRef.current) / 1000);
    if (!entries.some((m) => m.role === 'user')) {
      setSummary({ customer_intent: 'NONE', order_id: null, resolution_status: 'NO_INTERACTION', call_summary: 'Call ended before the customer spoke.', duration_seconds: duration, customer_turns: 0 });
      return;
    }
    setLoadingSummary(true);
    let data;
    try {
      const res = await fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: entries }) });
      data = await res.json();
    } catch {
      data = { customer_intent: 'OTHER', order_id: null, resolution_status: 'UNRESOLVED', call_summary: 'Summary unavailable.' };
    }
    const lat = entries.filter((m) => m.latency).map((m) => m.latency);
    setSummary({
      ...data,
      duration_seconds: duration,
      customer_turns: entries.filter((m) => m.role === 'user').length,
      avg_agent_response_ms: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
      tools_used: [...new Set(entries.flatMap((m) => (m.tools || []).map((t) => t.name)))],
    });
    setLoadingSummary(false);
  };

  // Manual barge-in: stop the agent mid-sentence and start listening
  const interrupt = () => {
    turn.current++;
    abortRef.current?.abort();
    busy.current = false;
    speaker.current.cancel();
    listen();
  };

  // Type instead of speak (also used by the quick-try chips)
  const sendTyped = (text) => {
    const t = text.trim();
    if (!t || !active.current || busy.current) return;
    setDraft('');
    const r = recRef.current;
    recRef.current = null;
    r?.abort();
    speaker.current.cancel();
    handleUser(t);
  };

  const transcriptText = () =>
    logRef.current.map((m) => `[${m.time}] ${m.role === 'user' ? 'Customer' : 'Aria'}: ${m.text}`).join('\n');

  const avgLatency = (() => {
    const l = log.filter((m) => m.latency).map((m) => m.latency);
    return l.length ? (l.reduce((a, b) => a + b, 0) / l.length / 1000).toFixed(1) : null;
  })();

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M20 4c7 8 11 13.5 11 19a11 11 0 0 1-22 0C9 17.500 13 12 20 4Z" fill="#9BC5AE" />
            <path d="M20 12v22M20 22c3-1 5.500-3 7-6M20 27c-3-1-5-3-6.500-5.500" stroke="#1D3A31" strokeWidth="1.600" strokeLinecap="round" />
          </svg>
          <div>
            <h1>Aura Skincare</h1>
            <p>Talk to Aria, our support specialist</p>
          </div>
        </div>
        <div className="seg" role="group" aria-label="Call language">
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} disabled={inCall}>English</button>
          <button className={lang === 'hi' ? 'on' : ''} onClick={() => setLang('hi')} disabled={inCall}>Hinglish</button>
        </div>
      </header>

      {!SR && <p className="warn">Speech recognition isn&apos;t supported in this browser. Open the page in Google Chrome or Microsoft Edge to talk to Aria.</p>}
      {notice && <p className="warn" role="alert">{notice}</p>}

      <main className="grid">
        <section className="left">
          <div className="panel stage">
            <Orb status={status} />
            <p className={`state ${status}`} aria-live="polite">{STATE_LABEL[status]}</p>
            <p className="sub">
              {inCall
                ? `${fmtTime(elapsed)}${avgLatency ? `  ·  replies in about ${avgLatency}s` : ''}`
                : 'Press start, allow the microphone, and speak naturally.'}
            </p>

            <div className="controls">
              {!inCall ? (
                <button className="call start" onClick={startCall} disabled={!SR}>Start call</button>
              ) : (
                <button className="call end" onClick={endCall}>End call</button>
              )}
              {status === 'speaking' && <button className="ghost" onClick={interrupt}>Interrupt Aria</button>}
            </div>

            <form className="composer" onSubmit={(e) => { e.preventDefault(); sendTyped(draft); }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={inCall ? 'Or type your message' : 'Start a call to type or speak'}
                disabled={!inCall}
                aria-label="Type a message to Aria"
              />
              <button type="submit" disabled={!inCall || !draft.trim()}>Send</button>
            </form>

            <div className="chips" aria-label="Quick prompts">
              {TRY.map((t) => (
                <button key={t} className="chip" onClick={() => sendTyped(t)} disabled={!inCall || status === 'thinking'}>{t}</button>
              ))}
            </div>
            <p className="tip">Use headphones so Aria doesn&apos;t hear herself.</p>
          </div>

          <div className="panel orders">
            <div className="panel-head">
              <h2>Test orders</h2>
              <button className="link" onClick={resetOrders}>Reset demo data</button>
            </div>
            {orders.length === 0 && <p className="muted">Orders will appear once the server is running.</p>}
            {orders.map((o) => <OrderCard key={o.id} order={o} focused={o.id === focusId} />)}
          </div>
        </section>

        <section className="right">
          <div className="panel convo">
            <div className="panel-head">
              <h2>Live transcript</h2>
              {log.length > 0 && !inCall && <button className="link" onClick={() => download('aria-call-transcript.txt', transcriptText())}>Download</button>}
            </div>
            <div className="transcript">
              {!log.length && !interim && (
                <p className="empty">Your conversation with Aria will appear here, along with every order lookup she makes.</p>
              )}
              {log.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="meta">
                    {m.role === 'user' ? 'You' : 'Aria'} &middot; {m.time}
                    {m.latency ? ` · ${(m.latency / 1000).toFixed(1)}s` : ''}
                  </div>
                  {(m.tools || []).map((t, k) => (
                    <div className="tool" key={k}>
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.300" /><path d="M3.500 6.200l1.700 1.600 3.300-3.600" fill="none" stroke="currentColor" strokeWidth="1.300" strokeLinecap="round" /></svg>
                      {TOOL_LABEL[t.name] || t.name}
                      {t.output?.order_id || t.input?.order_id ? ` ${t.output?.order_id || t.input.order_id}` : ''}
                      {toolOutcome(t.output) ? `: ${toolOutcome(t.output)}` : ''}
                    </div>
                  ))}
                  <div className="bubble">{m.text}</div>
                </div>
              ))}
              {interim && (
                <div className="msg user interim">
                  <div className="meta">You</div>
                  <div className="bubble">{interim}&hellip;</div>
                </div>
              )}
              {status === 'thinking' && (
                <div className="msg agent">
                  <div className="bubble typing" aria-label="Aria is thinking"><i /><i /><i /></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {(loadingSummary || summary) && (
            <div className="panel summary">
              <div className="panel-head">
                <h2>Call summary</h2>
                {summary && !loadingSummary && (
                  <div className="actions">
                    <button className="link" onClick={() => download('aria-call-transcript.txt', transcriptText())}>Download transcript</button>
                    <button className="link" onClick={() => download('aria-call-summary.json', JSON.stringify(summary, null, 2), 'application/json')}>Download JSON</button>
                  </div>
                )}
              </div>
              {loadingSummary ? (
                <p className="muted">Writing the summary&hellip;</p>
              ) : (
                <>
                  <dl className="facts">
                    <div><dt>Intent</dt><dd>{sentence(summary.customer_intent)}</dd></div>
                    <div><dt>Order</dt><dd>{summary.order_id || 'None'}</dd></div>
                    <div>
                      <dt>Outcome</dt>
                      <dd><span className={`pill ${summary.resolution_status === 'RESOLVED' ? 'ok' : summary.resolution_status === 'ESCALATION_NEEDED' ? 'bad' : 'soft'}`}>{sentence(summary.resolution_status)}</span></dd>
                    </div>
                    {summary.customer_sentiment && <div><dt>Sentiment</dt><dd>{sentence(summary.customer_sentiment)}</dd></div>}
                    <div><dt>Duration</dt><dd>{fmtTime(summary.duration_seconds || 0)}</dd></div>
                    {summary.avg_agent_response_ms != null && <div><dt>Avg reply time</dt><dd>{(summary.avg_agent_response_ms / 1000).toFixed(1)}s</dd></div>}
                  </dl>
                  <p className="digest">{summary.call_summary}</p>
                  {summary.actions_taken?.length > 0 && (
                    <ul className="actions-list">
                      {summary.actions_taken.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  )}
                  <details open>
                    <summary>Structured outcome (JSON)</summary>
                    <pre>{JSON.stringify(summary, null, 2)}</pre>
                  </details>
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}