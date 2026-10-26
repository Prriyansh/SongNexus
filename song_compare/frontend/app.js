// Song Compare page. Talks to the Flask API and draws the comparison with the main Song Nexus
// app's components (class names from src/frontend). Plain JavaScript, no build step.
const $ = (s, el = document) => el.querySelector(s);
const state = { a: null, b: null };
const pct = x => Math.round(x * 100);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const beats = n => (n ? `${n}/4` : "Unknown");
const cap = s => String(s ?? "").replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());

// Lucide icons (the main app's icon set), inlined as SVG paths.
const ICONS = {
  music: '<circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/>',
  user: '<path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
  wave: '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  compare: '<circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  disc: '<circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
};
const icon = (name, size = 16, width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
// Placeholders become the bare <svg>, as in the main app's markup (its CSS hides nav <span>s when
// the sidebar collapses); a styled wrapper such as .brand-mark keeps its element.
document.querySelectorAll("[data-icon]").forEach(el => {
  const svg = icon(el.dataset.icon, Number(el.dataset.size) || 16);
  if (el.classList.length) el.innerHTML = svg; else el.outerHTML = svg;
});
// Sidebar links go to the main app (NEXUS_URL comes from /config.js).
document.querySelectorAll("[data-nexus]").forEach(el => { el.href = (window.NEXUS_URL || "") + el.dataset.nexus; });

// The same stable colour per id as the main app's artwork placeholders.
function colorFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 30% 42%)`;
}
const cover = (id, size = "md") =>
  `<span class="album-cover cover-${size}" style="--art:${colorFor(id)}" aria-hidden="true">${icon("disc", 24, 1.25).replace('width="24" height="24"', 'style="width:42%;height:42%"')}</span>`;

async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}
function showError(msg) { const el = $("#error"); el.textContent = msg; el.hidden = !msg; }

// ---------- stats in the top bar
api("/api/stats").then(s => {
  $("#stats").textContent = `${s.songs.toLocaleString()} songs · ${s.with_lyrics.toLocaleString()} with lyric analysis`;
}).catch(e => showError(e.message));

// ---------- pickers: the main app's chooser (button + search popover)
const subtitle = t => [t.artists.join(", "), t.genre].filter(Boolean).join(" · ");

function renderChooser(slot) {
  const el = $(`.chooser[data-slot=${slot}]`), track = state[slot];
  el.innerHTML = `<span class="field-label">${slot === "a" ? "SONG ONE" : "SONG TWO"}</span>
    <button class="chooser-button" aria-expanded="false">${track ? cover(track.id, "sm") : icon("music", 20)}
      <strong class="${track ? "" : "placeholder"}">${track ? esc(track.title) : "Search a song or artist"}</strong>${icon("chevron-down")}</button>`;
  $(".chooser-button", el).onclick = () => openChooser(slot);
}

function openChooser(slot) {
  document.querySelectorAll(".chooser-popover").forEach(p => p.remove());
  const el = $(`.chooser[data-slot=${slot}]`);
  $(".chooser-button", el).classList.add("open");
  $(".chooser-button", el).setAttribute("aria-expanded", "true");
  el.insertAdjacentHTML("beforeend", `<div class="chooser-popover">
    <label class="chooser-search">${icon("search", 17)}<input aria-label="Search songs" placeholder="Search a song or artist…" autocomplete="off"></label>
    <div class="chooser-results"><p class="no-match">Type at least 2 letters.</p></div></div>`);
  const input = $(".chooser-search input", el), results = $(".chooser-results", el);
  input.focus();
  let timer, items = {};
  input.addEventListener("input", () => {
    clearTimeout(timer);                                   // wait for a pause in typing
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = `<p class="no-match">Type at least 2 letters.</p>`; return; }
      results.innerHTML = `<p class="no-match">Searching…</p>`;
      try {
        const other = state[slot === "a" ? "b" : "a"];
        const found = (await api(`/api/search?q=${encodeURIComponent(q)}`)).results.filter(t => !other || t.id !== other.id);
        items = Object.fromEntries(found.map(t => [t.id, t]));
        results.innerHTML = found.map(t => `<button class="chooser-option" data-id="${esc(t.id)}">${cover(t.id, "sm")}
          <span><strong>${esc(t.title)}</strong><small>${esc(subtitle(t))}</small></span>${state[slot]?.id === t.id ? icon("check") : ""}</button>`).join("")
          || `<p class="no-match">No matches in this dataset.</p>`;
      } catch (e) { results.innerHTML = `<p class="no-match error-text">${esc(e.message)}</p>`; }
    }, 300);
  });
  results.addEventListener("click", e => {
    const option = e.target.closest(".chooser-option");
    if (option) { choose(slot, items[option.dataset.id]); closeChoosers(); }
  });
}
function closeChoosers() {
  document.querySelectorAll(".chooser-popover").forEach(p => p.remove());
  document.querySelectorAll(".chooser-button").forEach(b => { b.classList.remove("open"); b.setAttribute("aria-expanded", "false"); });
}
document.addEventListener("mousedown", e => { if (!e.target.closest(".chooser")) closeChoosers(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeChoosers(); });

function choose(slot, track) {
  state[slot] = track;
  renderChooser(slot);
  const cards = $("#cards");
  cards.hidden = !(state.a || state.b);
  cards.innerHTML = ["a", "b"].filter(s => state[s]).map(s => { const t = state[s]; return `<div class="selected-card">${cover(t.id, "lg")}
    <span class="selected-card-info"><span class="selected-index">${s === "a" ? "01 / LEFT" : "02 / RIGHT"}</span>
    <strong>${esc(t.title)}</strong><small>${esc([t.artists.join(", "), t.album, t.genre].filter(Boolean).join(" · "))}</small></span></div>`; }).join("");
  $("#go").disabled = !(state.a && state.b);
}
renderChooser("a");
renderChooser("b");

$("#go").onclick = run;

async function run() {
  showError("");
  const go = $("#go");
  go.disabled = true;
  go.innerHTML = `${icon("compare")} Comparing…`;
  try {
    const d = await api(`/api/compare?a=${encodeURIComponent(state.a.id)}&b=${encodeURIComponent(state.b.id)}`);
    render(d);
    const [ma, mb] = await Promise.all([api(`/api/similar/${encodeURIComponent(state.a.id)}?k=8`), api(`/api/similar/${encodeURIComponent(state.b.id)}?k=8`)]);
    renderMore(d, ma.results, mb.results);
  } catch (e) { showError(e.message); }
  go.disabled = !(state.a && state.b);
  go.innerHTML = `${icon("compare")} Compare`;
}

// ---------- drawing
const sectionTitle = (overline, title, iconName) =>
  `<div class="section-title"><div><span class="overline">${overline}</span><h3>${title}</h3></div>${iconName ? icon(iconName, 20) : ""}</div>`;
const row = (name, a, b) => `<div class="comparison-row"><span>${name}</span><div class="comparison-cell"><p>${a}</p></div><div class="comparison-cell"><p>${b}</p></div></div>`;
const bars = (a, b) => `<div class="audio-bar"><span class="bar-a" style="width:${a}%"></span>${b == null ? "" : `<span class="bar-b" style="width:${b}%"></span>`}</div>`;
const insight = (n, title, body) => `<div class="insight-block"><span class="insight-number">${n}</span><div><strong>${title}</strong>${body}</div></div>`;

function render(d) {
  $("#empty").hidden = true; $("#result").hidden = false;
  const { a, b, structure: s } = d, la = a.lyrics?.structure, lb = b.lyrics?.structure;

  // Side by side, like the main app's comparison table
  let rows = row("Artists", esc(a.artists.join(", ")), esc(b.artists.join(", "))) +
    row("Album", esc(a.album || "—"), esc(b.album || "—")) +
    row("Genre", esc(cap(a.genre) || "—"), esc(cap(b.genre) || "—")) +
    row("Length", mmss(s.duration_sec.a), mmss(s.duration_sec.b)) +
    row("Tempo", `${s.tempo.a} BPM`, `${s.tempo.b} BPM`) +
    row("Key", esc(s.key.a), esc(s.key.b)) +
    row("Time signature", beats(s.time_signature.a), beats(s.time_signature.b));
  if (la && lb) {
    rows += row("Verses / choruses / bridges", `${la.verses} / ${la.choruses} / ${la.bridges}`, `${lb.verses} / ${lb.choruses} / ${lb.bridges}`) +
      row("Repeated lines", `${pct(la.repetition)}%`, `${pct(lb.repetition)}%`) +
      row("Word count", la.words, lb.words) +
      row("Vocabulary variety", `${pct(la.lexical_diversity)}%`, `${pct(lb.lexical_diversity)}%`);
  }
  const notes = [s.key.relation !== "unknown" ? `Keys: ${s.key.relation}.` : "", s.tempo.half_double_match ? "Tempos match in half or double time." : ""].filter(Boolean).join(" ");
  $("#details").innerHTML = sectionTitle("SIDE BY SIDE", "Listen for the similarities.") +
    `<div class="comparison-row comparison-row-heading"><span></span><strong>${esc(a.title)}</strong><strong>${esc(b.title)}</strong></div>` + rows +
    `<p class="metadata-note">${esc(notes)} Audio features come from Spotify's analysis in the dataset; lyric figures are computed from the lyrics, which aren't stored or shown.</p>`;

  // Sound profile: the main app's paired bars
  const feats = ["energy", "danceability", "valence", "acousticness", "speechiness", "liveness", "instrumentalness"];
  $("#sound").innerHTML = sectionTitle("02 / SOUND PROFILE", "How they sound") +
    `<div class="bar-key"><span><i class="key-a"></i>${esc(a.title)}</span><span><i class="key-b"></i>${esc(b.title)}</span></div>` +
    feats.map(f => `<div class="audio-row"><div class="audio-label"><span>${cap(f === "valence" ? "positivity" : f)}</span><strong>${pct(a.audio[f])} <em>/</em> ${pct(b.audio[f])}</strong></div>${bars(pct(a.audio[f]), pct(b.audio[f]))}</div>`).join("");

  // Lyrics: mood and themes per song, then how the lyric score breaks down
  const L = d.lyrics;
  if (!L) {
    $("#lyrics").innerHTML = sectionTitle("LYRICS", "What they're about") + `<p class="loading-text">Lyrics weren't matched for one or both songs, so the match uses sound only.</p>`;
  } else {
    const side = t => { const x = t.lyrics, v = x.sentiment.compound; return `<div><strong>${esc(t.title)}</strong>
      <div class="chip-row"><span class="chip">${esc(cap(x.top_emotion))}</span><span class="chip">${v > 0.1 ? "Positive" : v < -0.1 ? "Negative" : "Mixed"} (${v.toFixed(2)})</span>
      ${x.top_themes.map(h => `<span class="chip">${esc(cap(h))}</span>`).join("")}</div></div>`; };
    $("#lyrics").innerHTML = sectionTitle("LYRICS", "What they're about") + `<div class="lyric-sides">${side(a)}${side(b)}</div>` +
      [["Meaning", L.semantic], ["Shared words", L.vocabulary], ["Themes", L.themes], ["Sentiment", L.sentiment]]
        .map(([n, v]) => `<div class="audio-row"><div class="audio-label"><span>${n}</span><strong>${pct(v)}%</strong></div>${bars(pct(v))}</div>`).join("");
  }

  // Insights: overall match, why, and shared credits
  const c = d.credits;
  const shared = [c.artists.length ? `Artists: ${c.artists.join(", ")}` : "", c.same_album ? `Album: ${c.album}` : "", c.same_genre ? `Genre: ${cap(c.genre)}` : ""].filter(Boolean);
  $("#insights").innerHTML = sectionTitle("03 / DISCOVER INSIGHTS", "What connects them?", "compare") +
    `<div class="match-score"><strong>${pct(d.overall)}%</strong><small>overall match</small></div>
     <div class="score-bars"><div class="audio-row"><span>Sound</span>${bars(pct(d.audio.score))}<b>${pct(d.audio.score)}%</b></div>
       <div class="audio-row"><span>Lyrics</span>${L ? bars(pct(L.score)) : bars(0)}<b>${L ? pct(L.score) + "%" : "n/a"}</b></div></div>` +
    insight("01", "Why", `<ul class="reason-list">${d.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`) +
    insight("02", "Shared credits", `<p>${shared.length ? esc(shared.join(" · ")) : "No shared artist, album or genre."}</p>`);
}

function renderMore(d, ma, mb) {
  const list = (title, items) => `<p><strong>Like ${esc(title)}</strong></p>` + items.slice(0, 4).map(t =>
    `<button class="mini-entity" data-id="${esc(t.id)}">${cover(t.id, "sm")}<span><strong>${esc(t.title)}</strong>
     <small>${esc(t.artists.join(", "))} · ${pct(t.score)}% similar${t.shares_artist ? " · same artist" : ""}</small></span>${icon("arrow", 15)}</button>`).join("");
  const items = Object.fromEntries([...ma, ...mb].map(t => [t.id, t]));
  $("#more").innerHTML = `<span class="overline">GO DEEPER</span><h3>Songs that sound like these</h3>
    <p>Select one to compare it with ${esc(d.a.title)}.</p>${list(d.a.title, ma)}${list(d.b.title, mb)}`;
  // Picking a suggestion puts it in slot B and compares again.
  document.querySelectorAll("#more .mini-entity").forEach(el => el.onclick = () => {
    choose("b", items[el.dataset.id]); run(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
