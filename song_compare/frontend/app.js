// Talks to the Flask API and draws the comparison. Plain JavaScript, no build step.
const $ = (s, el = document) => el.querySelector(s);
const state = { a: null, b: null };
const pct = x => Math.round(x * 100);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}

// ---------- stats in the top bar
api("/api/stats").then(s => {
  $("#stats").textContent = `${s.songs.toLocaleString()} songs, ${s.with_lyrics.toLocaleString()} with lyrics` +
    (s.match_rate != null ? ` (${(s.match_rate * 100).toFixed(1)}% matched)` : "");
}).catch(e => showError(e.message));

function showError(msg) { const el = $("#error"); el.textContent = msg; el.hidden = !msg; }

// ---------- pickers with live search
document.querySelectorAll(".picker").forEach(picker => {
  const slot = picker.dataset.slot, input = $("input", picker), list = $(".suggest", picker);
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);                                   // wait for a pause in typing
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      try {
        const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        list.innerHTML = results.map(t =>
          `<li data-id="${esc(t.id)}"><span>${esc(t.title)}</span><small>${esc(t.artists.join(", "))}${t.genre ? " · " + esc(t.genre) : ""}</small></li>`
        ).join("") || `<li><small>No matches</small></li>`;
        list.hidden = false;
        list._items = Object.fromEntries(results.map(t => [t.id, t]));
      } catch (e) { showError(e.message); }
    }, 200);
  });
  list.addEventListener("click", e => {
    const li = e.target.closest("li[data-id]");
    if (li) choose(slot, list._items[li.dataset.id]);
  });
  document.addEventListener("click", e => { if (!picker.contains(e.target)) list.hidden = true; });
});

function choose(slot, track) {
  state[slot] = track;
  const p = $(`.picker[data-slot=${slot}]`);
  $("input", p).hidden = true; $(".suggest", p).hidden = true;
  const c = $(".chosen", p);
  c.hidden = false;
  c.innerHTML = `<div class="thumb">${esc(track.title[0])}</div>
    <div><b>${esc(track.title)}</b><small>${esc(track.artists.join(", "))}</small></div>
    <button class="x" title="Change">&times;</button>`;
  $(".x", c).onclick = () => {
    state[slot] = null; c.hidden = true; $("input", p).hidden = false; $("input", p).value = ""; $("input", p).focus();
    $("#go").disabled = true;
  };
  $("#go").disabled = !(state.a && state.b);
}

$("#go").onclick = run;

async function run() {
  showError("");
  try {
    const d = await api(`/api/compare?a=${state.a.id}&b=${state.b.id}`);
    render(d);
    const [ma, mb] = await Promise.all([api(`/api/similar/${state.a.id}?k=8`), api(`/api/similar/${state.b.id}?k=8`)]);
    renderMore(d, ma.results, mb.results);
  } catch (e) { showError(e.message); }
}

// ---------- drawing
function render(d) {
  $("#empty").hidden = true; $("#result").hidden = false;
  $("#overall").textContent = pct(d.overall);
  $("#valAudio").textContent = pct(d.audio.score) + "%";
  $("#barAudio").style.width = pct(d.audio.score) + "%";
  const hasL = !!d.lyrics;
  $("#valLyric").textContent = hasL ? pct(d.lyrics.score) + "%" : "n/a";
  $("#barLyric").style.width = hasL ? pct(d.lyrics.score) + "%" : "0";
  $("#reasons").innerHTML = d.reasons.map(r => `<li>${esc(r)}</li>`).join("");

  // Sound: one row per audio feature, red bar for A, white bar for B
  const feats = ["energy", "danceability", "valence", "acousticness", "speechiness", "liveness", "instrumentalness"];
  $("#sound").innerHTML =
    `<div class="legend"><span><i style="background:var(--red)"></i>${esc(d.a.title)}</span><span><i style="background:#fff"></i>${esc(d.b.title)}</span></div>` +
    feats.map(f => `<div class="frow"><span class="name">${f}</span>
      <div class="bars"><div class="track a"><i style="width:${pct(d.a.audio[f])}%"></i></div><div class="track b"><i style="width:${pct(d.b.audio[f])}%"></i></div></div>
      <span class="nums">${pct(d.a.audio[f])} / ${pct(d.b.audio[f])}</span></div>`).join("");

  // Structure table
  const s = d.structure, la = d.a.lyrics?.structure, lb = d.b.lyrics?.structure;
  const row = (k, a, b) => `<tr><th>${k}</th><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
  let rows = row("Tempo", `${s.tempo.a} BPM`, `${s.tempo.b} BPM`) + row("Key", s.key.a, s.key.b) +
    row("Time signature", `${s.time_signature.a}/4`, `${s.time_signature.b}/4`) +
    row("Length", mmss(s.duration_sec.a), mmss(s.duration_sec.b));
  if (la && lb) {
    rows += row("Verses / choruses / bridges", `${la.verses} / ${la.choruses} / ${la.bridges}`, `${lb.verses} / ${lb.choruses} / ${lb.bridges}`) +
      row("Repeated lines", pct(la.repetition) + "%", pct(lb.repetition) + "%") +
      row("Word count", la.words, lb.words) + row("Vocabulary variety", pct(la.lexical_diversity) + "%", pct(lb.lexical_diversity) + "%");
  }
  $("#structure").innerHTML = `<thead><tr><th></th><th>${esc(d.a.title)}</th><th>${esc(d.b.title)}</th></tr></thead>` + rows;
  const note = s.key.relation !== "unknown" ? `Keys: ${s.key.relation}.` : "";
  $("#structure").nextElementSibling?.classList.contains("note") && $("#structure").nextElementSibling.remove();
  $("#structure").insertAdjacentHTML("afterend", `<p class="note">${esc(note)}${s.tempo.half_double_match ? " Tempos match in half or double time." : ""}</p>`);

  // Credits
  const c = d.credits;
  $("#credits").innerHTML =
    `<div class="sub">Artists on both songs</div><div class="chips">${c.artists.length ? c.artists.map(a => `<span class="chip hot">${esc(a)}</span>`).join("") : '<span class="muted">None</span>'}</div>` +
    `<div class="sub">Also shared</div><div class="chips">${c.same_album ? `<span class="chip">Album: ${esc(c.album)}</span>` : ""}${c.same_genre ? `<span class="chip">Genre: ${esc(c.genre)}</span>` : ""}${!c.same_album && !c.same_genre ? '<span class="muted">Nothing else</span>' : ""}</div>`;

  // Lyrics (numbers only, the lyric text itself is never sent to the browser)
  if (!hasL) {
    $("#lyrics").innerHTML = `<p class="muted">Lyrics were not matched for one or both songs.</p>`;
  } else {
    const L = d.lyrics, side = (t) => {
      const x = t.lyrics, v = x.sentiment.compound;
      return `<div><b>${esc(t.title)}</b>
        <div class="sub">Mood</div><div class="chips"><span class="chip hot">${esc(x.top_emotion)}</span><span class="chip">${v > 0.1 ? "positive" : v < -0.1 ? "negative" : "mixed"} (${v.toFixed(2)})</span></div>
        <div class="sub">Themes</div><div class="chips">${x.top_themes.map(h => `<span class="chip">${esc(h)}</span>`).join("") || '<span class="muted">None detected</span>'}</div></div>`;
    };
    $("#lyrics").innerHTML = `<div class="two">${side(d.a)}${side(d.b)}</div>
      <div class="sub">Similarity breakdown</div>
      ${[["Meaning (semantic)", L.semantic], ["Shared vocabulary", L.vocabulary], ["Themes", L.themes], ["Sentiment", L.sentiment]]
        .map(([n, v]) => `<div class="mini"><span style="width:auto">${n}</span><div class="track"><i style="width:${pct(v)}%"></i></div><b>${pct(v)}%</b></div>`).join("")}
      <p class="note">Based on analysis of the lyrics. The lyric text itself is not stored or shown.</p>`;
    document.querySelectorAll("#lyrics .mini").forEach(m => m.style.gridTemplateColumns = "170px 1fr 48px");
  }
}

function renderMore(d, ma, mb) {
  const col = (title, items) => `<div><h3>Like ${esc(title)}</h3><div class="cards">${items.slice(0, 5).map(t =>
    `<div class="song" data-id="${esc(t.id)}" data-json='${esc(JSON.stringify(t))}'><div class="thumb">${esc(t.title[0])}</div>
     <b>${esc(t.title)}</b><small>${esc(t.artists.join(", "))}</small><small>${pct(t.score)}% similar${t.shares_artist ? " · same artist" : ""}</small></div>`).join("")}</div></div>`;
  $("#more").innerHTML = `<div class="rail">${col(d.a.title, ma)}${col(d.b.title, mb)}</div>`;
  // Click a suggestion to put it in slot B and compare again
  document.querySelectorAll("#more .song").forEach(el => el.onclick = () => {
    choose("b", JSON.parse(el.dataset.json)); run(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
