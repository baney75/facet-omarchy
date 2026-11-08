// Instant answers. answer(query, opts) resolves to a result object or null.
// Result: { kind, title, value, detail?, links? }. Network calls go through opts.fetch (default global fetch).

// ---------- calculator (recursive descent, no eval) ----------
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, log2: Math.log2,
  exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src) {
  const s = src.replace(/(\d),(?=\d{3}(\D|$))/g, "$1").replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^");
  const out = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?|([a-z_][a-z0-9_]*)|([-+*/^%(),x]))/gy;
  let pos = 0, m;
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(pos))) break; return null; }
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1] + (m[2] ? "e" + m[2] : "")) });
    else if (m[3] !== undefined) {
      if (m[3] === "x") out.push({ t: "op", v: "*" });
      else if (m[3] === "mod") out.push({ t: "op", v: "mod" });
      else out.push({ t: "id", v: m[3] });
    } else out.push({ t: "op", v: m[4] });
  }
  return out;
}

export function calculate(src) {
  const toks = tokenize(String(src).toLowerCase());
  if (!toks || !toks.length) return null;
  let i = 0, ops = 0;
  const peek = () => toks[i];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const fail = () => { throw new Error("parse"); };
  function expr() {
    let v = term();
    while (isOp("+") || isOp("-")) { const o = toks[i++].v; const r = term(); v = o === "+" ? v + r : v - r; ops++; }
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) { const o = toks[i++].v; const r = unary(); v = o === "*" ? v * r : v / r; ops++; }
      else if (peek() && (peek().t === "num" || peek().t === "id" || isOp("("))) { v *= unary(); ops++; } // implicit multiply: 2pi, 2(3)
      else if (isOp("%") && toks[i + 1] && (toks[i + 1].t === "num" || toks[i + 1].v === "(")) { i++; v %= unary(); ops++; }
      else return v;
    }
  }
  function unary() {
    if (isOp("-")) { i++; return -unary(); }
    if (isOp("+")) { i++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp("^")) { i++; ops++; return Math.pow(base, unary()); }
    return base;
  }
  function postfix() {
    let v = atom();
    while (isOp("%") && !(toks[i + 1] && (toks[i + 1].t === "num" || toks[i + 1].v === "("))) { i++; v /= 100; ops++; }
    return v;
  }
  function atom() {
    const t = toks[i++];
    if (!t) fail();
    if (t.t === "num") return t.v;
    if (t.t === "id") {
      if (t.v in CONSTS) return CONSTS[t.v];
      if (t.v in FUNCS) {
        let arg;
        if (isOp("(")) { i++; arg = expr(); if (!isOp(")")) fail(); i++; } else arg = unary();
        ops++;
        return FUNCS[t.v](arg);
      }
      fail();
    }
    if (t.v === "(") { const v = expr(); if (!isOp(")")) fail(); i++; return v; }
    fail();
  }
  try {
    const v = expr();
    if (i !== toks.length || !Number.isFinite(v) || ops === 0) return null;
    return v;
  } catch { return null; }
}

export function formatNumber(n, digits = 10) {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && (Math.abs(n) >= 1e15 || Math.abs(n) < 1e-7)) return n.toExponential(6).replace(/\.?0+e/, "e");
  const r = Number(n.toPrecision(digits));
  return r.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

// ---------- units ----------
// factor converts to the base unit of the dimension.
const U = {};
function def(dim, factor, ...names) { for (const n of names) U[n] = { dim, factor }; }
def("length", 1, "m", "meter", "meters", "metre", "metres");
def("length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres");
def("length", 0.01, "cm", "centimeter", "centimeters");
def("length", 0.001, "mm", "millimeter", "millimeters");
def("length", 0.3048, "ft", "foot", "feet");
def("length", 0.0254, "in", "inch", "inches");
def("length", 0.9144, "yd", "yard", "yards");
def("length", 1609.344, "mi", "mile", "miles");
def("length", 1852, "nmi", "nautical mile", "nautical miles");
def("mass", 1, "g", "gram", "grams");
def("mass", 1000, "kg", "kilogram", "kilograms", "kilo", "kilos");
def("mass", 0.001, "mg", "milligram", "milligrams");
def("mass", 453.59237, "lb", "lbs", "pound", "pounds");
def("mass", 28.349523125, "oz", "ounce", "ounces");
def("mass", 6350.29318, "st", "stone");
def("mass", 1e6, "t", "tonne", "tonnes", "metric ton", "metric tons");
def("volume", 1, "l", "liter", "liters", "litre", "litres");
def("volume", 0.001, "ml", "milliliter", "milliliters");
def("volume", 3.785411784, "gal", "gallon", "gallons");
def("volume", 0.946352946, "qt", "quart", "quarts");
def("volume", 0.473176473, "pt", "pint", "pints");
def("volume", 0.2365882365, "cup", "cups");
def("volume", 0.0295735295625, "fl oz", "floz", "fluid ounce", "fluid ounces");
def("volume", 0.01478676478125, "tbsp", "tablespoon", "tablespoons");
def("volume", 0.00492892159375, "tsp", "teaspoon", "teaspoons");
def("time", 1, "s", "sec", "secs", "second", "seconds");
def("time", 60, "min", "mins", "minute", "minutes");
def("time", 3600, "h", "hr", "hrs", "hour", "hours");
def("time", 86400, "d", "day", "days");
def("time", 604800, "week", "weeks");
def("data", 1, "b", "byte", "bytes");
def("data", 1e3, "kb", "kilobyte", "kilobytes");
def("data", 1e6, "mb", "megabyte", "megabytes");
def("data", 1e9, "gb", "gigabyte", "gigabytes");
def("data", 1e12, "tb", "terabyte", "terabytes");
def("data", 1024, "kib");
def("data", 1048576, "mib");
def("data", 1073741824, "gib");
def("speed", 1, "m/s", "mps");
def("speed", 0.277777778, "km/h", "kph", "kmh");
def("speed", 0.44704, "mph", "mi/h");
def("speed", 0.514444444, "kn", "knot", "knots");
def("area", 1, "m2", "sqm", "square meter", "square meters");
def("area", 4046.8564224, "acre", "acres");
def("area", 10000, "hectare", "hectares", "ha");
def("area", 0.09290304, "sqft", "square foot", "square feet");
def("area", 1e6, "km2", "sqkm");
def("area", 2589988.110336, "sqmi", "square mile", "square miles");
const TEMP = { c: "c", celsius: "c", "°c": "c", f: "f", fahrenheit: "f", "°f": "f", k: "k", kelvin: "k" };

function norm(u) { return u.trim().toLowerCase().replace(/\s+/g, " "); }
function toTemp(v, from, to) {
  const c = from === "c" ? v : from === "f" ? (v - 32) * 5 / 9 : v - 273.15;
  return to === "c" ? c : to === "f" ? c * 9 / 5 + 32 : c + 273.15;
}

export function convertUnits(value, fromRaw, toRaw) {
  const from = norm(fromRaw), to = norm(toRaw);
  if (TEMP[from] && TEMP[to]) return toTemp(value, TEMP[from], TEMP[to]);
  const a = U[from], b = U[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return value * a.factor / b.factor;
}

// ---------- currency ----------
const SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW", "₽": "RUB", "C$": "CAD", "A$": "AUD" };
const NAMES = { dollar: "USD", dollars: "USD", usd: "USD", euro: "EUR", euros: "EUR", pound: "GBP", pounds: "GBP", yen: "JPY", rupee: "INR", rupees: "INR", peso: "MXN", pesos: "MXN", franc: "CHF", francs: "CHF", yuan: "CNY", rmb: "CNY" };

function currencyCode(raw) {
  const t = raw.trim();
  if (SYMBOLS[t]) return SYMBOLS[t];
  const l = t.toLowerCase();
  if (NAMES[l] && !(U[l])) return NAMES[l];
  if (/^[a-z]{3}$/i.test(t) && !U[l] && !TEMP[l]) return t.toUpperCase();
  return null;
}

export async function convertCurrency(amount, from, to, fetchFn = fetch) {
  if (from === to) return { amount, rate: 1, date: null };
  const url = `https://api.frankfurter.app/latest?amount=${encodeURIComponent(amount)}&from=${from}&to=${to}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const j = await res.json();
  const out = j.rates?.[to];
  if (typeof out !== "number") throw new Error("no rate");
  return { amount: out, rate: out / amount, date: j.date || null };
}

// ---------- weather (open-meteo) ----------
const WMO = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Heavy freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, heavy hail",
};
export const weatherText = (code) => WMO[code] || "Unknown";

export async function weatherFor(city, { fetch: fetchFn = fetch, units = "fahrenheit" } = {}) {
  const g = await (await fetchFn(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)).json();
  const place = g.results?.[0];
  if (!place) return null;
  const mph = units === "fahrenheit";
  const u = `temperature_unit=${units}&wind_speed_unit=${mph ? "mph" : "kmh"}`;
  const w = await (await fetchFn(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5&${u}`)).json();
  const c = w.current;
  if (!c) return null;
  const unit = mph ? "F" : "C";
  return {
    place: [place.name, place.admin1, place.country_code].filter(Boolean).join(", "),
    temp: c.temperature_2m, feels: c.apparent_temperature, wind: c.wind_speed_10m,
    code: c.weather_code, text: weatherText(c.weather_code), unit,
    days: (w.daily?.time || []).map((d, k) => ({ date: d, hi: w.daily.temperature_2m_max[k], lo: w.daily.temperature_2m_min[k], text: weatherText(w.daily.weather_code[k]) })),
  };
}

// ---------- package tracking ----------
export function trackingLinks(query) {
  const q = query.replace(/^(track(ing)?( number| package)?|package)\s*:?\s*/i, "").replace(/[\s-]/g, "");
  const hits = [];
  const add = (carrier, url) => hits.push({ carrier, url });
  if (/^1Z[0-9A-Z]{16}$/i.test(q)) add("UPS", `https://www.ups.com/track?tracknum=${q.toUpperCase()}`);
  if (/^(94|93|92|95)\d{20}$/.test(q) || /^(94|93|92|95)\d{24}$/.test(q) || /^[A-Z]{2}\d{9}US$/i.test(q)) add("USPS", `https://tools.usps.com/go/TrackConfirmation?tLabels=${q.toUpperCase()}`);
  if (/^\d{12}$/.test(q) || /^\d{15}$/.test(q) || /^(96|98)\d{20}$/.test(q) || /^\d{20}$/.test(q) || /^\d{22}$/.test(q)) add("FedEx", `https://www.fedex.com/fedextrack/?trknbr=${q}`);
  if (/^\d{20,22}$/.test(q) && !hits.some((h) => h.carrier === "USPS")) add("USPS", `https://tools.usps.com/go/TrackConfirmation?tLabels=${q}`);
  if (/^TBA\d{9,14}$/i.test(q)) add("Amazon", `https://www.amazon.com/progress-tracker/package?trackingId=${q.toUpperCase()}`);
  if (/^\d{3}-\d{7}-\d{7}$/.test(query.trim().replace(/^.*?(\d{3}-\d{7}-\d{7}).*$/, "$1"))) {
    const id = query.match(/\d{3}-\d{7}-\d{7}/)[0];
    add("Amazon", `https://www.amazon.com/gp/your-account/order-details?orderID=${id}`);
  }
  return hits;
}

// ---------- entry point ----------
export async function answer(query, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch?.bind(globalThis);
  const q = String(query ?? "").trim();
  if (!q) return null;

  // tracking
  const tr = trackingLinks(q);
  if (tr.length) return { kind: "tracking", title: `${tr[0].carrier} tracking`, value: tr[0].url, links: tr };

  // weather
  const wm = q.match(/^(?:weather|forecast|temperature)(?:\s+(?:in|for|at))?\s+(.+)$/i) || q.match(/^(.+?)\s+(?:weather|forecast)$/i);
  if (wm && fetchFn) {
    const w = await weatherFor(wm[1].replace(/[?]/g, ""), { fetch: fetchFn, units: opts.units });
    if (!w) return null;
    return { kind: "weather", title: w.place, value: `${Math.round(w.temp)}°${w.unit}, ${w.text}`, detail: w };
  }

  // percent-of
  const pm = q.match(/^([\d.,]+)\s*%\s*of\s*([\d.,]+)$/i);
  if (pm) {
    const v = parseFloat(pm[1].replace(/,/g, "")) * parseFloat(pm[2].replace(/,/g, "")) / 100;
    return { kind: "calc", title: q, value: formatNumber(v) };
  }

  // conversion: "<amount> <from> to <to>"
  const cm = q.match(/^([$€£¥₹₩₽]|[CA]\$)?\s*(-?[\d.,]+(?:e[+-]?\d+)?)\s*([^\d\s][^]*?)?\s+(?:to|in|into|as|=)\s+(.+)$/i);
  if (cm) {
    const amount = parseFloat(cm[2].replace(/,/g, ""));
    const fromRaw = (cm[1] || cm[3] || "").trim();
    const toRaw = cm[4].trim();
    if (Number.isFinite(amount) && fromRaw) {
      const val = convertUnits(amount, fromRaw, toRaw);
      if (val !== null) return { kind: "unit", title: `${formatNumber(amount)} ${fromRaw} to ${toRaw}`, value: `${formatNumber(val)} ${toRaw}` };
      const f = currencyCode(fromRaw), t = currencyCode(toRaw);
      if (f && t && fetchFn) {
        const r = await convertCurrency(amount, f, t, fetchFn);
        return { kind: "currency", title: `${formatNumber(amount)} ${f} to ${t}`, value: `${formatNumber(r.amount, 8)} ${t}`, detail: { rate: r.rate, date: r.date } };
      }
    }
  }

  // calculator
  const v = calculate(q.replace(/=\s*$/, ""));
  if (v !== null) return { kind: "calc", title: q, value: formatNumber(v) };
  return null;
}
