import React, { Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import * as THREE from "three";
import Scene from "./scene/Scene.jsx";
import { checkpoints, finale, site } from "./content.js";
import { CARD_HOLD, CARD_LEAD, HERO_END, checkpointProgress, journey, rideAmount } from "./journey.js";
import { rideAudio } from "./audio/rideAudio.js";
import "./styles.css";


function activeCheckpoint(ride) {
  for (let i = 0; i < checkpoints.length; i++) {
    const start = checkpoints[i].at - CARD_LEAD;
    const next = checkpoints[i + 1];
    const end = Math.min(checkpoints[i].at + CARD_HOLD, next ? next.at - CARD_LEAD : 0.97);
    if (ride >= start && ride < end) return i;
  }
  return -1;
}

// Loading screen: the road-marking motif again, twelve dashes that light up as
// the bike model streams in.
const DASHES = 12;
function Loader() {
  const { progress, active } = useProgress();
  const done = !active && progress >= 100;
  const lit = Math.round((progress / 100) * DASHES);
  return (
    <div className={`loader ${done ? "is-done" : ""}`} aria-hidden={done} role="status">
      <div className="loader-brand"><span className="brand-mark">&lt;/&gt;</span>{site.name}</div>
      <div className="loader-road">
        {Array.from({ length: DASHES }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}
      </div>
      <div className="loader-meta"><span>Warming up the engine</span><span>{String(Math.round(progress)).padStart(2, "0")}%</span></div>
    </div>
  );
}

// Route bar: the whole ride as a line, one stop per checkpoint. The bright part
// and the blue marker follow the bike (not the scrollbar); stops are clickable.
function Route({ routeRef, passed, active, onJump }) {
  const stops = [
    { number: "00", title: "Start", p: 0 },
    ...checkpoints.map((c) => ({ number: c.number, title: c.title, p: checkpointProgress(c.at) })),
    { number: finale.number, title: "Contact", p: 1 },
  ];
  return (
    <nav className="route" ref={routeRef} aria-label="Jump to a stop on the ride">
      <div className="route-track"><i className="route-fill" /></div>
      <div className="route-bike"><i /></div>
      {stops.map((st, i) => {
        const state = i === 0 || i <= passed ? "passed" : "ahead";
        return (
          <button
            key={st.number}
            type="button"
            className={`route-stop is-${state} ${i - 1 === active ? "is-active" : ""}`}
            style={{ left: `${st.p * 100}%` }}
            onClick={() => onJump(i)}
            aria-label={`${st.number} ${st.title}`}
          >
            <span className="route-dot" />
            <span className="route-label"><b>{st.number}</b>{st.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SoundIcon({ on }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
      {on ? (
        <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M10.5 6l3.5 4M14 6l-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}

// Static film grain, generated once. Cheap: no blend modes, never repainted.
function useGrain() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    setUrl(c.toDataURL());
  }, []);
  return url;
}

// The panel opens with a small plate that mirrors the roadside sign, so the
// physical checkpoint (where I am) and the panel (what happened there) read as one.
function Item({ it }) {
  if (typeof it === "string") return <li className="item-line">{it}</li>;
  return (
    <li className="item">
      <div className="item-head">
        <span className="item-name">{it.name}</span>
        {it.status && <span className="item-status">{it.status}</span>}
        {it.value && <span className="item-value">{it.value}</span>}
      </div>
      {it.meta && <span className="item-meta">{it.meta}</span>}
      {it.text && <p className="item-text">{it.text}</p>}
    </li>
  );
}

function Card({ c, state }) {
  const rich = c.items && typeof c.items[0] !== "string";
  return (
    <article className={`checkpoint-card is-${state}`} aria-hidden={state !== "active"}>
      <div className="plate">
        <span className="plate-num">{c.number}</span>
        <span className="plate-label">{c.label}</span>
      </div>
      <h2>{c.title}</h2>
      <p className="card-body">{c.body}</p>
      {c.stat && (
        <div className="stat"><span className="stat-value">{c.stat.value}</span><span className="stat-unit">{c.stat.unit}</span></div>
      )}
      {c.items && (
        <ul className={rich ? "items is-rich" : "items"}>
          {c.items.map((it) => <Item key={typeof it === "string" ? it : it.name} it={it} />)}
        </ul>
      )}
      {c.groups && (
        <div className="groups">
          {c.groups.map((g) => (
            <div className="group" key={g.label}>
              <span className="group-label">{g.label}</span>
              <div className="chips">{g.chips.map((ch) => <span key={ch}>{ch}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function App() {
  const trackRef = useRef(null);
  const finishRef = useRef(null);
  const introRef = useRef(null);
  const heroFootRef = useRef(null);
  const routeRef = useRef(null);
  const [active, setActive] = useState(-1);
  const [passed, setPassed] = useState(0); // checkpoints already ridden past
  const [introIn, setIntroIn] = useState(false);
  const [sound, setSound] = useState(false);
  const grain = useGrain();

  useEffect(() => {
    const show = () => setIntroIn(true);
    window.addEventListener("ride:intro", show);
    return () => window.removeEventListener("ride:intro", show);
  }, []);

  const toggleSound = async () => {
    if (sound) {
      rideAudio.disable();
      setSound(false);
    } else {
      const ok = await rideAudio.enable();
      setSound(ok);
    }
  };

  useEffect(() => {
    // Layout values are read once per resize, never inside the scroll handler.
    let maxScroll = 1, finaleTop = Infinity, vh = window.innerHeight;
    const measure = () => {
      vh = window.innerHeight;
      maxScroll = Math.max(1, trackRef.current.offsetHeight - vh);
      finaleTop = finishRef.current.offsetTop;
      journey.maxScroll = maxScroll;
    };

    // Called by the 3D scene whenever the bike moves (p = the bike's progress).
    // Everything that tells the story follows the bike, not the scrollbar.
    const ui = {
      update(p) {
        routeRef.current?.style.setProperty("--ride", p.toFixed(4));
        const fade = 1 - THREE.MathUtils.clamp(p / (HERO_END * 0.5), 0, 1);
        introRef.current?.style.setProperty("--hero-fade", fade.toFixed(3));
        heroFootRef.current?.style.setProperty("--hero-fade", Math.max(0, fade * 2 - 1).toFixed(3));
        introRef.current?.classList.toggle("is-gone", fade < 0.2);
        const ride = rideAmount(p);
                // no panel while jumping/rewinding past stops; it opens when the bike arrives
        setActive(journey.finaleIn || journey.jump || journey.rewinding ? -1 : activeCheckpoint(ride));
        setPassed(journey.finaleIn ? checkpoints.length + 1 : checkpoints.filter((c) => ride >= c.at - CARD_LEAD).length);
      },
    };
    journey.ui = ui;

    // The scroll handler only says where the bike should go.
    const onScroll = () => {
      const y = window.scrollY;
      journey.target = THREE.MathUtils.clamp(y / maxScroll, 0, 1);
      const finaleIn = y + vh * 0.92 > finaleTop;
      if (finaleIn !== journey.finaleIn) {
        journey.finaleIn = finaleIn;
        ui.update(journey.smooth);
      }
      journey.invalidate?.();
    };

    const onResize = () => { measure(); onScroll(); };
    measure();
    onScroll();
    ui.update(journey.smooth);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      journey.ui = null;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Route-bar jump: move the page there instantly; the bike then rides there at a
  // steady (faster) speed, and the panel opens when it arrives.
  const jumpTo = (i) => {
    if (i === checkpoints.length + 1) {
      finishRef.current.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const p = i === 0 ? 0 : checkpointProgress(checkpoints[i - 1].at) + 0.004;
    journey.jump = true;
    window.scrollTo({ top: p * (journey.maxScroll || 1), behavior: "instant" });
  };

  const goToContact = (e) => {
    e.preventDefault();
    finishRef.current.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="journey-page">
      <div className="canvas-wrap" aria-hidden="true">
        <Canvas frameloop="demand" shadows dpr={[1, 1.25]} gl={{ antialias: true, powerPreference: "high-performance", toneMappingExposure: 1.05 }}>
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>
      </div>
      <Loader />
      {grain && <div className="grain" style={{ backgroundImage: `url(${grain})` }} aria-hidden="true" />}

      <header className="topbar">
        <div className="brand"><span className="brand-mark">&lt;/&gt;</span>{site.name}</div>
        <nav className="topbar-actions">
          <button className="nav-link sound" type="button" aria-pressed={sound} aria-label={sound ? "Sound on" : "Sound off"} onClick={toggleSound}>
            <SoundIcon on={sound} /> {sound ? "Sound on" : "Sound off"}
          </button>
          <a className="nav-link" href="#contact" onClick={goToContact}>Contact</a>
        </nav>
        <Route routeRef={routeRef} passed={passed} active={active} onJump={jumpTo} />
      </header>

      {/* Hero. The statement itself is rendered in the 3D scene behind the bike, and the
          name stands on the start-line sign; the HTML here is only the quiet frame. */}
      <section className={`intro ${introIn ? "is-in" : ""}`} ref={introRef}>
        <h1 className="sr-only">{site.name}, {site.role}. {site.statement.join(" ")}</h1>
        <p className="eyebrow"><span className="eyebrow-rule" aria-hidden="true" />{site.role}</p>
        <p className="intro-line">{site.line}</p>
      </section>

      <div className={`hero-foot ${introIn ? "is-in" : ""}`} ref={heroFootRef}>
        <div className="scroll-invite" aria-hidden="true">
          <span>Scroll to ride</span>
          <i className="lane"><b /><b /><b /></i>
        </div>
      </div>

      <div className="checkpoints">
        {checkpoints.map((c, i) => (
          <Card key={c.number} c={c} state={i === active ? "active" : i < passed ? "past" : "next"} />
        ))}
      </div>

      <div className="track" ref={trackRef} />

      <section className="finish" id="contact" ref={finishRef}>
        <p className="eyebrow"><span className="eyebrow-num">{finale.number}</span>{finale.label}</p>
        <h2>{finale.title[0]}<br />{finale.title[1]}</h2>
        <p className="finish-body">{finale.body}</p>
        <div className="finish-actions">
          <a className="button-primary" href={`mailto:${site.email}`}>Email me</a>
          {site.links.map((l) => (
            <a key={l.label} className="button-ghost" href={l.href} target="_blank" rel="noreferrer">{l.label}</a>
          ))}
        </div>
        <dl className="finish-meta">
          <div><dt>Email</dt><dd><a href={`mailto:${site.email}`}>{site.email}</a></dd></div>
          <div><dt>Based in</dt><dd>{site.location}</dd></div>
        </dl>
      </section>
    </main>
  );
}

// `?notext` hides every piece of text (HTML and 3D) to judge the bare composition.
if (new URLSearchParams(window.location.search).has("notext")) document.body.classList.add("notext");

createRoot(document.getElementById("root")).render(<App />);
