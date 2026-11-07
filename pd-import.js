/* Phila-Del Coverage: import a coverage sheet (CSV or PDF) into the Editor.
   Reads the left (Philadelphia) block of the weekly sheet: day headers ("16 Monday Coverage Hours"),
   then rows of  [out person + clinic + note] [covering person] [hours].
   The right-hand Delaware block is ignored (those clinics are not in the app).
   Changes go through the Editor's own state (window.__PD_IMPORT, set by the app on every render),
   so they are saved and synced exactly like edits made by hand. */
(function () {
  "use strict";
  var WD = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var WD_JS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  var IN_HOUSE = "In house";
  var C = { green: "#3E8E41", greenDeep: "#2A6B30", blue: "#5B9AC6", blueDeep: "#35709B", mist: "#EEF5F0", line: "#D6E4DA", ink: "#14301E", soft: "#5B7364", warn: "#B4581B" };
  var GRAD = "linear-gradient(135deg,#3E8E41 0%,#4B9A74 48%,#5B9AC6 100%)";
  var FONT = '"Avenir Next","Nunito","Segoe UI",system-ui,sans-serif';
  var api = function () { return window.__PD_IMPORT; };

  /* ---------------- small helpers ---------------- */
  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); };
  var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var isoOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var fromIso = function (s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
  var fmtDay = function (s) { return fromIso(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  var to12 = function (t) { if (!t) return ""; var h = +t.slice(0, 2), m = +t.slice(3); var ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? h + ":" + pad(m) + ap : h + ap; };
  var el = function (tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "style") Object.assign(e.style, attrs.style);
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k != null) e.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return e;
  };

  /* ---------------- CSV ---------------- */
  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function recordsFromCSV(rows) {
    var recs = [], cols = null;
    rows.forEach(function (r) {
      var c = r.map(function (x) { return String(x || "").trim(); });
      var wd = -1;
      for (var i = 1; i < Math.min(c.length, 4); i++) if (WD.indexOf(c[i].toLowerCase()) >= 0 && /^\d{1,2}$/.test(c[i - 1])) { wd = i; break; }
      if (wd > 0) {
        var cov = -1, hrs = -1;
        for (var j = wd + 1; j < c.length; j++) { if (cov < 0 && /^coverage$/i.test(c[j])) cov = j; else if (cov >= 0 && /^hours$/i.test(c[j])) { hrs = j; break; } }
        cols = { label: wd, cover: cov > 0 ? cov : wd + 1, hours: hrs > 0 ? hrs : wd + 2 };
        recs.push({ kind: "day", day: +c[wd - 1], weekday: c[wd].toLowerCase() });
        return;
      }
      if (!cols) return;
      var label = c[cols.label] || "", cover = c[cols.cover] || "", hours = c[cols.hours] || "";
      if (label || cover || hours) recs.push({ kind: "row", label: label, cover: cover, hours: hours });
    });
    return recs;
  }

  /* ---------------- PDF ---------------- */
  var HOURISH = /^(\d|as$|needed$|am$|pm$|noon$|close$|tbd$|all$|day$)/i;
  function recordsFromPDF(items) {
    // split merged text pieces into words with an estimated x position
    var words = [];
    items.forEach(function (it) {
      var s = it.str, cw = it.w && s.length ? it.w / s.length : 4, re = /\S+/g, m;
      while ((m = re.exec(s))) words.push({ page: it.page, y: it.y, x: it.x + m.index * cw, str: m[0], start: m.index === 0 });
    });
    words.sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; });
    var lines = [];
    words.forEach(function (w) {
      var L = lines[lines.length - 1];
      if (L && L.page === w.page && Math.abs(L.y - w.y) < 3) L.w.push(w); else lines.push({ page: w.page, y: w.y, w: [w] });
    });
    var recs = [], cols = null;
    lines.forEach(function (L) {
      var it = L.w.sort(function (a, b) { return a.x - b.x; });
      var hi = -1;
      for (var i = 1; i < Math.min(it.length, 4); i++) if (WD.indexOf(it[i].str.toLowerCase()) >= 0 && /^\d{1,2}$/.test(it[i - 1].str)) { hi = i; break; }
      if (hi > 0) {
        var cov = null, hrs = null;
        it.forEach(function (w) { if (!cov && w.x > it[hi].x && /^coverage$/i.test(w.str)) cov = w; else if (cov && !hrs && w.x > cov.x && /^hours$/i.test(w.str)) hrs = w; });
        var labelX = it[hi].x, coverX = cov ? cov.x : labelX + 108, hoursX = hrs ? hrs.x : coverX + 43;
        var after = it.filter(function (w) { return w.x > hoursX + 25; });
        var rightX = after.length ? Math.min.apply(null, after.map(function (w) { return w.x; })) - 18 : Infinity;
        cols = { labelX: labelX, coverX: coverX, hoursX: hoursX, rightX: rightX };
        recs.push({ kind: "day", day: +it[hi - 1].str, weekday: it[hi].str.toLowerCase() });
        return;
      }
      if (!cols) return;
      var band = function (lo, hi2) { return it.filter(function (w) { return w.x >= lo - 4 && w.x < hi2 - 4; }).map(function (w) { return w.str; }); };
      var label = band(cols.labelX, cols.coverX), cover = band(cols.coverX, cols.hoursX), hours = band(cols.hoursX, cols.rightX);
      // a merged "name + hours" piece: move hour-like words from the end of the cover cell to hours
      var k = cover.findIndex(function (w) { return HOURISH.test(w); });
      if (k > 0 || (k === 0 && cover.length && !hours.length)) { hours = cover.slice(k).concat(hours); cover = cover.slice(0, k); }
      var r = { kind: "row", label: label.join(" "), cover: cover.join(" "), hours: hours.join(" ") };
      if (r.label || r.cover || r.hours) recs.push(r);
    });
    return recs;
  }

  /* ---------------- dates ---------------- */
  function resolveDates(days, firstIso) {
    // days: [{day, weekday}] in sheet order. Pick the first date, then walk forward.
    var out = [], prev = null;
    days.forEach(function (d, idx) {
      var date = null;
      if (idx === 0) date = firstIso ? fromIso(firstIso) : null;
      else for (var k = 1; k <= 7; k++) { var c = new Date(prev); c.setDate(c.getDate() + k); if (c.getDate() === d.day && c.getDay() === WD_JS[d.weekday]) { date = c; break; } }
      out.push(date ? isoOf(date) : null); if (date) prev = date;
    });
    return out;
  }
  function guessFirst(day, weekday, fileName) {
    var today = new Date(); today.setHours(12, 0, 0, 0);
    var cands = [];
    for (var m = -6; m <= 6; m++) {
      var c = new Date(today.getFullYear(), today.getMonth() + m, day, 12);
      if (c.getDate() === day && c.getDay() === WD_JS[weekday]) cands.push(c);
    }
    var hint = (fileName || "").match(/(\d{1,2})[-_.]?(\d{2})(?!\d)/);
    if (hint && +hint[2] === day) {
      var h = cands.filter(function (c) { return c.getMonth() + 1 === +hint[1]; });
      if (h.length) cands = h;
    }
    if (!cands.length) return null;
    cands.sort(function (a, b) { return Math.abs(a - today) - Math.abs(b - today); });
    return isoOf(cands[0]);
  }

  /* ---------------- hours ---------------- */
  function tok(s) {
    var m = String(s).match(/^(\d{1,4})(?::(\d{2}))?$/); if (!m) return null;
    var d = m[1], h, mi;
    if (m[2]) { h = +d; mi = +m[2]; } else if (d.length <= 2) { h = +d; mi = 0; } else { h = +d.slice(0, d.length - 2); mi = +d.slice(-2); }
    if (h > 23 || mi > 59) return null; return { h: h, m: mi };
  }
  function parseHours(text) {
    var raw = String(text || "").trim();
    if (!raw) return [{ start: "08:00", end: "16:00", hours: "", dflt: true }];
    var segs = raw.split("/"), out = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i].toLowerCase().replace(/\s+/g, "");
      var m = s.match(/^(\d{1,4}(?::\d{2})?)(am|pm)?(?:-|–|,|to)(\d{1,4}(?::\d{2})?)(am|pm)?$/);
      if (!m) return [{ start: "", end: "", hours: raw, dflt: false, bad: !/^(as ?needed|am|pm|tbd|all ?day)$/i.test(raw) }];
      var a = tok(m[1]), b = tok(m[3]); if (!a || !b) return [{ start: "", end: "", hours: raw, dflt: false, bad: true }];
      var sh = a.h;
      if (m[2] === "pm") sh = a.h === 12 ? 12 : a.h + 12; else if (m[2] === "am") sh = a.h === 12 ? 0 : a.h; else if (a.h < 6) sh = a.h + 12;
      var st = sh * 60 + a.m, en;
      if (m[4] === "pm") en = (b.h === 12 ? 12 : b.h + 12) * 60 + b.m;
      else if (m[4] === "am") en = (b.h === 12 ? 0 : b.h) * 60 + b.m;
      else { en = b.h * 60 + b.m; if (en <= st) en += 720; }
      if (en <= st || en > 24 * 60) return [{ start: "", end: "", hours: raw, dflt: false, bad: true }];
      out.push({ start: pad(Math.floor(st / 60)) + ":" + pad(st % 60), end: pad(Math.floor(en / 60)) + ":" + pad(en % 60), hours: "", dflt: false });
    }
    return out;
  }
  var hoursLabel = function (h) { return h.start ? to12(h.start) + " – " + to12(h.end) + (h.dflt ? "*" : "") : (h.hours || "Hours TBD"); };

  /* ---------------- clinics and people ---------------- */
  var MANUAL = {
    "bala n": "bala cynwyd north", "bala north": "bala cynwyd north", "bala cynwyd n": "bala cynwyd north", "bn": "bala cynwyd north",
    "bala s": "bala cynwyd south", "bala south": "bala cynwyd south", "bala cynwyd s": "bala cynwyd south", "bs": "bala cynwyd south",
    "ucity": "university city", "u city": "university city", "uc": "university city", "univ city": "university city", "university city": "university city",
    "ud": "upper darby", "upper darby": "upper darby", "wads": "wadsworth", "wadsworth": "wadsworth",
    "hp": "hunting park", "hunting park": "hunting park", "ridley": "milmont", "milmont": "milmont",
    "del ave": "delaware ave", "delaware ave": "delaware ave", "broad": "broad street", "broad st": "broad street",
    "frankford": "frankford", "grant": "grant", "aston": "aston", "aramingo": "aramingo", "passyunk": "passyunk"
  };
  function aliasMap(locs) {
    var map = {}, firsts = {};
    locs.forEach(function (l) { var n = norm(l.name); map[n] = l.name; var f = n.split(" ")[0]; firsts[f] = (firsts[f] || []).concat(l.name); });
    Object.keys(firsts).forEach(function (f) { if (firsts[f].length === 1 && !map[f]) map[f] = firsts[f][0]; });
    Object.keys(MANUAL).forEach(function (a) {
      var target = MANUAL[a], hit = locs.filter(function (l) { return norm(l.name).indexOf(target) >= 0; });
      if (hit.length === 1) map[a] = hit[0].name;
    });
    return map;
  }
  function findClinic(label, amap) {
    var raw = String(label).trim().split(/\s+/).filter(Boolean), t = raw.map(norm);
    for (var i = 0; i < t.length; i++) for (var len = 3; len >= 1; len--) {
      if (i + len > t.length) continue;
      var ph = t.slice(i, i + len).join(" ");
      if (amap[ph]) return { clinic: amap[ph], before: raw.slice(0, i), after: raw.slice(i + len) };
    }
    return { clinic: "", before: raw, after: [] };
  }
  function staffIndex(staff) {
    var byFull = {}, byFirst = {};
    staff.forEach(function (s) { var n = norm(s.name); byFull[n] = s.name; var f = n.split(" ")[0]; (byFirst[f] = byFirst[f] || []).push(s.name); });
    return function (word) { var n = norm(word); if (byFull[n]) return byFull[n]; var f = n.split(" ")[0]; return byFirst[f] && byFirst[f].length === 1 ? byFirst[f][0] : null; };
  }
  function parseCover(raw, who) {
    var s = String(raw || "").trim(), flags = [];
    if (!s) return { therapist: "", note: "", flags: flags };
    var q = s.indexOf("?") >= 0, t = s.replace(/\?/g, "").trim();
    if (/^in[\s-]*house$/i.test(t)) { if (q) flags.push("The sheet says \u201c" + s + "\u201d (with a question mark)"); return { therapist: IN_HOUSE, note: "", flags: flags }; }
    if (/^(need|needed|open|tbd|none)$/i.test(t)) return { therapist: "", note: "", flags: flags };
    var parts = t.split(/\s*\/\s*/).filter(Boolean), found = null, extra = [], unknown = [];
    parts.forEach(function (p) {
      var w = p.split(/\s+/), name = who(w.slice(0, 2).join(" ")) || who(w[0]);
      if (name && !found) { found = name; var used = norm(name).split(" ").length > 1 && norm(w.slice(0, 2).join(" ")) === norm(name) ? 2 : 1; extra = extra.concat(w.slice(used)); }
      else if (name) { flags.push("Two names on the sheet (\u201c" + s + "\u201d); using " + found); }
      else unknown.push(p);
    });
    if (!found) { flags.push("\u201c" + s + "\u201d is not in the staff list, so the shift is left open"); return { therapist: "", note: "Sheet: " + s, flags: flags }; }
    if (unknown.length) flags.push("Also on the sheet: \u201c" + unknown.join(" / ") + "\u201d");
    if (q) flags.push("The sheet has a question mark: \u201c" + s + "\u201d");
    var note = extra.join(" ");
    if (unknown.length || q || parts.length > 1) note = ((note ? note + " · " : "") + "Sheet: " + s);
    return { therapist: found, note: note, flags: flags };
  }

  /* ---------------- turn sheet records into proposed shifts ---------------- */
  function interpret(recs, firstIso, a) {
    var amap = aliasMap(a.locs), who = staffIndex(a.staff);
    var days = recs.filter(function (r) { return r.kind === "day"; });
    var dates = resolveDates(days, firstIso), di = -1, prevClinic = "", prevType = "Coverage", rows = [];
    recs.forEach(function (r) {
      if (r.kind === "day") { di++; prevClinic = ""; prevType = "Coverage"; return; }
      if (di < 0) return;
      var date = dates[di], flags = [];
      var f = findClinic(r.label, amap), clinic = f.clinic;
      var after = f.after.map(norm), type = "Coverage", rest = [];
      f.after.forEach(function (w, i) {
        var n = after[i];
        if (n === "extra") type = "Extra"; else if (/^evals?$/.test(n)) type = "Evals"; else if (/^(evening|eve)$/.test(n)) type = "Evening";
        else if (/^need(ed)?$/.test(n)) { if (!f.before.length) type = "Help/Need"; } else rest.push(w);
      });
      if (!clinic) {
        if (!r.label.trim() && prevClinic) { clinic = prevClinic; type = prevType; flags.push("No clinic on this row; using the row above (" + prevClinic + ", " + prevType + ")"); }
        else if (/\bbala\b/i.test(r.label)) flags.push("\u201cBala\u201d alone could be North or South; pick the clinic");
        else flags.push("Could not match a clinic in \u201c" + r.label + "\u201d; pick one or untick the row");
      }
      if (clinic) { prevClinic = clinic; prevType = type; }
      var out = f.before.join(" ").trim();
      var cov = parseCover(r.cover, who); flags = flags.concat(cov.flags);
      var notes = [out ? cap(out) + " out" : "", rest.join(" "), cov.note].filter(Boolean);
      var hs = parseHours(r.hours);
      if (hs[0].bad) flags.push("Could not read the hours \u201c" + r.hours + "\u201d; kept as a label");
      if (hs.length > 1) flags.push("Two time blocks (\u201c" + r.hours + "\u201d) became two shifts");
      if (!date) flags.push("Could not work out the date for this day");
      hs.forEach(function (h) {
        rows.push({ include: !!date, date: date, clinic: clinic, therapist: cov.therapist, start: h.start, end: h.end, hours: h.hours, dflt: h.dflt, type: type,
          note: notes.join(" · "), flags: flags.slice(), src: [r.label, r.cover, r.hours].filter(Boolean).join(" | "), hoursText: r.hours });
      });
    });
    return { rows: rows, dates: dates.filter(Boolean), days: days };
  }

  /* ---------------- merge into the schedule ---------------- */
  function plan(rows, mode, a) {
    var locks = a.locks || {}, prev = a.items || [];
    var isLocked = function (d, c) { return !!locks[d + "|" + c]; };
    var use = rows.filter(function (r) { return r.include && r.date && r.clinic; });
    var dates = {}; use.forEach(function (r) { dates[r.date] = true; });
    var skipped = use.filter(function (r) { return isLocked(r.date, r.clinic); });
    use = use.filter(function (r) { return !isLocked(r.date, r.clinic); });
    var ids = {}; prev.forEach(function (x) { ids[x.id] = true; });
    var nid = Date.now(), newId = function () { while (ids[nid]) nid++; ids[nid] = true; return nid++; };
    // candidates that a sheet row may take over (keeps the id and any sticky note); never mutate app state
    var pool = prev.filter(function (x) { return dates[x.date] && !isLocked(x.date, x.clinic); });
    var used = {};
    var take = function (r) {
      var tiers = [
        function (x) { return x.therapist === r.therapist; },          // same person
        function (x) { return !x.therapist; },                        // an open need at that clinic
        function (x) { return mode === "replace"; }                   // any other shift there (replace mode only)
      ];
      for (var t = 0; t < tiers.length; t++) {
        var hit = pool.find(function (x) { return !used[x.id] && x.date === r.date && x.clinic === r.clinic && tiers[t](x); });
        if (hit) { used[hit.id] = true; return hit; }
      }
      return null;
    };
    var made = {}, added = 0, updated = 0;
    use.forEach(function (r) {
      var row = { date: r.date, clinic: r.clinic, therapist: r.therapist, start: r.start, end: r.end, hours: r.hours, type: r.type, note: r.note, dflt: !!r.dflt, sticky: "" };
      var old = take(r);
      if (old) { row.id = old.id; row.sticky = old.sticky || ""; made[old.id] = row; updated++; }
      else { row.id = newId(); made[row.id] = row; added++; }
    });
    var next = [], goneList = [];
    prev.forEach(function (x) {
      if (made[x.id]) { next.push(made[x.id]); delete made[x.id]; return; }
      if (mode === "replace" && dates[x.date] && !isLocked(x.date, x.clinic)) { goneList.push(x); return; }
      next.push(x);
    });
    Object.keys(made).forEach(function (k) { next.push(made[k]); });
    return { goneList: goneList, next: next, added: added, updated: updated, removed: goneList.length, skipped: skipped.length, count: use.length, dates: Object.keys(dates).sort() };
  }

  /* ---------------- review dialog ---------------- */
  var dlg = null;
  function close() { if (dlg) { dlg.remove(); dlg = null; } }
  function selectOf(options, value, onChange, label) {
    var s = el("select", { "aria-label": label, style: { width: "100%", padding: "5px 6px", fontSize: "13px", borderRadius: "8px", border: "1.5px solid " + C.line, background: C.mist, fontFamily: FONT, color: C.ink } });
    options.forEach(function (o) { var op = el("option", { value: o[0], text: o[1] }); if (o[0] === value) op.selected = true; s.appendChild(op); });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function review(recs, fileName) {
    var a = api();
    var days = recs.filter(function (r) { return r.kind === "day"; });
    if (!days.length) { alert("No day headings like \u201c16 Monday  Coverage  Hours\u201d were found in that file, so nothing was imported."); return; }
    var first = guessFirst(days[0].day, days[0].weekday, fileName);
    var state = { first: first, mode: "replace", res: interpret(recs, first, a) };
    close();
    var body = el("div", { style: { overflow: "auto", flex: "1", padding: "0 18px" } });
    var foot = el("div", { style: { padding: "12px 18px 16px", borderTop: "1px solid " + C.line, display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } });
    var info = el("div", { style: { fontSize: "13.5px", color: C.soft, flex: "1", minWidth: "220px" } });
    var go = el("button", { style: { border: "none", background: GRAD, color: "#fff", fontWeight: "800", fontSize: "15px", padding: "11px 18px", borderRadius: "12px", cursor: "pointer", fontFamily: FONT } });
    var cancel = el("button", { text: "Cancel", onclick: close, style: { background: "#fff", border: "1.5px solid " + C.line, color: C.ink, fontWeight: "700", fontSize: "15px", padding: "10px 16px", borderRadius: "12px", cursor: "pointer", fontFamily: FONT } });
    var dateIn = el("input", { type: "date", value: first || "", "aria-label": "Date of the first day on the sheet", style: { padding: "6px 8px", borderRadius: "8px", border: "1.5px solid " + C.line, fontFamily: FONT, fontSize: "14px" } });
    dateIn.addEventListener("change", function () { state.first = dateIn.value; state.res = interpret(recs, state.first, api()); draw(); });
    var modeBox = el("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "13.5px" } });
    [["replace", "Match the sheet: replace these days (finalized clinics are kept)"], ["merge", "Add and update only: keep shifts that are not on the sheet"]].forEach(function (m) {
      var r = el("input", { type: "radio", name: "pdimpmode", value: m[0] }); if (m[0] === state.mode) r.checked = true;
      r.addEventListener("change", function () { state.mode = m[0]; draw(); });
      modeBox.appendChild(el("label", { style: { display: "inline-flex", gap: "6px", alignItems: "center", cursor: "pointer" } }, [r, m[1]]));
    });
    var head = el("div", { style: { padding: "14px 18px 10px" } }, [
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" } }, [
        el("div", { style: { fontWeight: "800", fontSize: "19px", color: C.greenDeep }, text: "Import coverage sheet" }),
        el("button", { "aria-label": "Close", onclick: close, text: "\u00d7", style: { border: "none", background: C.mist, width: "34px", height: "34px", borderRadius: "17px", fontSize: "20px", cursor: "pointer" } })
      ]),
      el("div", { style: { fontSize: "13px", color: C.soft, margin: "4px 0 10px" }, text: fileName + " \u00b7 reads the Philadelphia block on the left; the Delaware block is ignored." }),
      el("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px", fontSize: "13.5px", fontWeight: "700", color: C.ink } }, ["First day on the sheet:", dateIn, el("span", { style: { fontWeight: "600", color: C.soft }, text: "(check the month and year)" })]),
      modeBox
    ]);
    function draw() {
      var a2 = api(); body.innerHTML = "";
      var res = state.res, rows = res.rows;
      var locOpts = [["", "Pick a clinic"]].concat(a2.locs.map(function (l) { return [l.name, l.name]; }));
      var stOpts = [["", "Open"], [IN_HOUSE, IN_HOUSE]].concat(a2.staff.map(function (s) { return [s.name, s.name]; }));
      var tbl = el("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: "13px" } });
      var hr = el("tr", {}, ["Use", "Day", "Clinic", "Covering", "Hours", "Type", "Note / check"].map(function (h) { return el("th", { text: h, style: { textAlign: "left", padding: "8px 6px", borderBottom: "1px solid " + C.line, color: C.soft, position: "sticky", top: "0", background: "#fff", zIndex: "1" } }); }));
      tbl.appendChild(hr);
      var lastDate = null;
      rows.forEach(function (r) {
        if (r.date !== lastDate) {
          lastDate = r.date;
          tbl.appendChild(el("tr", {}, [el("td", { colspan: "7", style: { padding: "10px 6px 4px", fontWeight: "800", color: C.blueDeep, fontSize: "12.5px", letterSpacing: ".04em", textTransform: "uppercase" }, text: r.date ? fmtDay(r.date) : "Unknown date" })]));
        }
        var locked = r.date && r.clinic && (a2.locks || {})[r.date + "|" + r.clinic];
        var flags = r.flags.concat(locked ? ["This clinic is finalized for that day; it will be skipped. Click Edit on it first to import."] : []);
        if (!r.clinic && r.include) flags = flags;
        var cb = el("input", { type: "checkbox", "aria-label": "Use this row" }); cb.checked = r.include; cb.disabled = !r.date;
        cb.addEventListener("change", function () { r.include = cb.checked; draw(); });
        var hIn = el("input", { value: r.hoursText || "", placeholder: "8-4 default", "aria-label": "Hours", style: { width: "92px", padding: "5px 6px", fontSize: "13px", borderRadius: "8px", border: "1.5px solid " + C.line, fontFamily: FONT } });
        hIn.addEventListener("change", function () { var h = parseHours(hIn.value)[0]; r.hoursText = hIn.value; r.start = h.start; r.end = h.end; r.hours = h.hours; r.dflt = h.dflt; draw(); });
        var tr = el("tr", { style: { background: !r.include ? "#F4F4F4" : flags.length ? "#FFF6EC" : "#fff", opacity: r.include ? "1" : ".6" } }, [
          el("td", { style: { padding: "6px" } }, [cb]),
          el("td", { style: { padding: "6px", whiteSpace: "nowrap", color: C.soft }, text: r.date ? fmtDay(r.date).split(",")[0] : "?" }),
          el("td", { style: { padding: "6px", minWidth: "150px" } }, [selectOf(locOpts, r.clinic, function (v) { r.clinic = v; draw(); }, "Clinic")]),
          el("td", { style: { padding: "6px", minWidth: "120px" } }, [selectOf(stOpts, r.therapist, function (v) { r.therapist = v; }, "Covering therapist")]),
          el("td", { style: { padding: "6px", whiteSpace: "nowrap" } }, [hIn, el("div", { style: { fontSize: "11.5px", color: C.soft, marginTop: "2px" }, text: hoursLabel(r) })]),
          el("td", { style: { padding: "6px" } }, [selectOf(["Coverage", "Extra", "Evening", "Evals", "Help/Need"].map(function (t) { return [t, t]; }), r.type, function (v) { r.type = v; }, "Type")]),
          el("td", { style: { padding: "6px", minWidth: "200px" } }, [
            el("div", { style: { color: C.ink }, text: r.note || "" }),
            el("div", { style: { fontSize: "11.5px", color: C.soft }, text: "Sheet: " + (r.src || "(blank)") }),
            flags.length ? el("div", { style: { color: C.warn, fontWeight: "700", fontSize: "12px", marginTop: "2px" }, text: "\u26a0 " + flags.join(". ") }) : null
          ])
        ]);
        tbl.appendChild(tr);
      });
      body.appendChild(tbl);
      var p = plan(rows, state.mode, a2);
      if (p.goneList.length) {
        var det = el("details", { style: { margin: "12px 0 14px", fontSize: "13px" } }, [
          el("summary", { style: { cursor: "pointer", fontWeight: "800", color: C.warn }, text: p.goneList.length + " shift" + (p.goneList.length === 1 ? "" : "s") + " in the app are not on the sheet and will be removed (click to see). Choose \u201cAdd and update only\u201d to keep them." })
        ].concat(p.goneList.slice().sort(function (x, y) { return x.date.localeCompare(y.date) || x.clinic.localeCompare(y.clinic); }).map(function (x) {
          return el("div", { style: { padding: "2px 0 2px 14px", color: C.ink }, text: fmtDay(x.date) + " \u00b7 " + x.clinic + " \u00b7 " + (x.therapist || "Open") + " \u00b7 " + hoursLabel(x) + (x.sticky ? " \u00b7 has a sticky note" : "") });
        })));
        body.appendChild(det);
      }
      var review = rows.filter(function (r) { return r.include && r.flags.length; }).length;
      var noClinic = rows.filter(function (r) { return r.include && !r.clinic; }).length;
      info.textContent = p.count + " shift" + (p.count === 1 ? "" : "s") + " for " + p.dates.length + " day" + (p.dates.length === 1 ? "" : "s") +
        (review ? " \u00b7 " + review + " to check (orange)" : "") + (noClinic ? " \u00b7 " + noClinic + " without a clinic will be left out" : "") +
        (p.skipped ? " \u00b7 " + p.skipped + " on finalized clinics skipped" : "") +
        (state.mode === "replace" && p.removed ? " \u00b7 " + p.removed + " existing shift" + (p.removed === 1 ? "" : "s") + " not on the sheet will be removed" : "");
      go.textContent = "Import " + p.count + " shift" + (p.count === 1 ? "" : "s");
      go.disabled = !p.count; go.style.opacity = p.count ? "1" : ".5";
    }
    go.addEventListener("click", function () {
      var a3 = api(); var p = plan(state.res.rows, state.mode, a3);
      if (!p.count) return;
      a3.setItems(p.next);
      var span = p.dates.length ? fmtDay(p.dates[0]) + (p.dates.length > 1 ? " to " + fmtDay(p.dates[p.dates.length - 1]) : "") : "";
      close();
      try { a3.flash("Imported " + p.count + " shifts for " + span + ". Use the week arrows to see them."); } catch (e) {}
    });
    foot.appendChild(info); foot.appendChild(cancel); foot.appendChild(go);
    dlg = el("div", { role: "dialog", "aria-label": "Import coverage sheet", style: { position: "fixed", inset: "0", background: "rgba(20,48,30,.55)", zIndex: "100000", display: "grid", placeItems: "center", padding: "14px", fontFamily: FONT, color: C.ink }, onclick: function (e) { if (e.target === dlg) close(); } }, [
      el("div", { style: { background: "#fff", borderRadius: "18px", width: "100%", maxWidth: "980px", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.35)" } }, [head, body, foot])
    ]);
    document.body.appendChild(dlg);
    draw();
  }

  /* ---------------- reading the file ---------------- */
  function loadPdfEngine() {
    if (window.__PD_PDF) return Promise.resolve(window.__PD_PDF);
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "pd-pdf.js";
      s.onload = function () { window.__PD_PDF ? res(window.__PD_PDF) : rej(new Error("PDF reader did not start")); };
      s.onerror = function () { rej(new Error("pd-pdf.js is missing next to index.html")); };
      document.head.appendChild(s);
    });
  }
  function readFile(file) {
    var name = file.name || "sheet", isPdf = /\.pdf$/i.test(name) || file.type === "application/pdf";
    if (/\.xlsx?$/i.test(name)) { alert("Save the Excel sheet as CSV (File > Save As > CSV) or as PDF, then import that file."); return; }
    if (isPdf) {
      file.arrayBuffer().then(function (buf) { return loadPdfEngine().then(function (P) { return P.textItems(buf); }); })
        .then(function (items) { review(recordsFromPDF(items), name); })
        .catch(function (e) { alert("That PDF could not be read: " + (e && e.message ? e.message : e)); });
    } else {
      file.text().then(function (t) { review(recordsFromCSV(parseCSV(t.replace(/^\ufeff/, ""))), name); })
        .catch(function () { alert("That file could not be read."); });
    }
  }
  function pick() {
    var inp = el("input", { type: "file", accept: ".csv,.pdf,text/csv,application/pdf", style: { display: "none" } });
    inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; inp.remove(); if (f) readFile(f); });
    document.body.appendChild(inp); inp.click();
  }

  /* ---------------- the Import button ---------------- */
  var btn = el("button", { id: "pd-import-btn", type: "button", title: "Import a coverage sheet (CSV or PDF)", onclick: pick, style: {
    display: "none", position: "fixed", right: "14px", top: "14px", zIndex: "99998", border: "none", background: GRAD, color: "#fff", fontWeight: "800", fontSize: "13.5px",
    padding: "9px 15px", borderRadius: "999px", cursor: "pointer", fontFamily: FONT, boxShadow: "0 6px 16px rgba(20,48,30,.35)" } }, ["\u21e9 Import sheet"]);
  function sync() { btn.style.display = api() && document.querySelector('nav[aria-label="Main"]') ? "inline-flex" : "none"; }
  function boot() { document.body.appendChild(btn); sync(); setInterval(sync, 1000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // exposed for testing
  window.__PD_IMPORT_LIB = { parseCSV: parseCSV, recordsFromCSV: recordsFromCSV, recordsFromPDF: recordsFromPDF, parseHours: parseHours, interpret: interpret, plan: plan, readFile: readFile, guessFirst: guessFirst };
})();
