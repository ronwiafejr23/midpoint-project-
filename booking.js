/* ==========================================================================
   booking.js — Antz Cuts booking page
   Powers book.html: pick a service -> pick a day -> pick a time -> details.

   Bookings are saved in this browser's localStorage (prototype only), so
   Anthony can't see them from his own phone. That's why the confirmation
   screen has a "Send to Anthony" button that opens a pre-filled email.
   ========================================================================== */

/* ---------- SETTINGS (edit these) ---------- */

const BARBER_EMAIL = "antscutz@gmail.com";
const SLOT_MINUTES = 30;
const DAYS_AHEAD = 60;            // how far ahead people can book

// Weekly hours. 0 = Sunday ... 6 = Saturday. null = closed.
const WEEKLY_HOURS = {
  0: { open: "08:30", close: "21:30" },
  1: { open: "08:35", close: "21:30" },
  2: { open: "16:35", close: "21:30" },
  3: { open: "14:35", close: "17:00" },
  4: { open: "16:35", close: "21:30" },
  5: { open: "14:35", close: "17:00" },
  6: null,
};

const SERVICES = [
  { id: "first",   name: "First Haircut (new clients)", price: "$5",     minutes: 30 },
  { id: "adult",   name: "Adult Haircut (12+)",         price: "$15",    minutes: 30 },
  { id: "kids",    name: "Kids Haircut (11 & under)",   price: "$10",    minutes: 25 },
  { id: "shave",   name: "Shave",                       price: "$10",    minutes: 20 },
  { id: "beard",   name: "Beard",                       price: "$5",     minutes: 5  },
  { id: "beardmu", name: "Beard & Mustache",            price: "$5",     minutes: 10 },
  { id: "mus",     name: "Mustache",                    price: "$5",     minutes: 5  },
  { id: "brows",   name: "Eyebrows",                    price: "$5",     minutes: 5  },
  { id: "house",   name: "House Call",                  price: "$25–35", minutes: 60 },
];

const KEYS = {
  daysOff: "antz_days_off",
  blockedSlots: "antz_blocked",
  bookings: "antz_bookings",
};

/* ---------- STORAGE ---------- */

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

/* ---------- DATE / TIME HELPERS ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function prettyTime(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
function prettyDate(key) {
  return parseKey(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function getService(id) { return SERVICES.find(s => s.id === id); }
function todayKey() { return dateKey(new Date()); }

/* ---------- AVAILABILITY ---------- */

function allSlots(key) {
  const hours = WEEKLY_HOURS[parseKey(key).getDay()];
  if (!hours) return [];
  const slots = [];
  for (let t = toMinutes(hours.open); t + SLOT_MINUTES <= toMinutes(hours.close); t += SLOT_MINUTES) {
    slots.push(toHHMM(t));
  }
  return slots;
}

function slotsNeeded(serviceId) {
  const svc = getService(serviceId);
  return Math.max(1, Math.ceil((svc ? svc.minutes : SLOT_MINUTES) / SLOT_MINUTES));
}

function bookedSlots(key) {
  const taken = new Set();
  for (const b of load(KEYS.bookings)) {
    if (b.date !== key) continue;
    const start = toMinutes(b.time);
    for (let i = 0; i < slotsNeeded(b.serviceId); i++) taken.add(toHHMM(start + i * SLOT_MINUTES));
  }
  return taken;
}

function isDayOff(key) { return load(KEYS.daysOff).includes(key); }
function isBlocked(key, time) { return load(KEYS.blockedSlots).includes(`${key} ${time}`); }

function isPast(key, time) {
  const [h, m] = time.split(":").map(Number);
  const d = parseKey(key);
  d.setHours(h, m, 0, 0);
  return d <= new Date();
}

function availableTimes(key, serviceId) {
  if (isDayOff(key)) return [];
  const slots = allSlots(key);
  const taken = bookedSlots(key);
  const need = slotsNeeded(serviceId);
  return slots.filter((time, i) => {
    if (isPast(key, time)) return false;
    for (let j = 0; j < need; j++) {
      const s = slots[i + j];
      if (!s || taken.has(s) || isBlocked(key, s)) return false;
    }
    return true;
  });
}

function addBooking(booking) {
  if (!availableTimes(booking.date, booking.serviceId).includes(booking.time)) return false;
  const all = load(KEYS.bookings);
  all.push({ id: Date.now().toString(36), ...booking });
  save(KEYS.bookings, all);
  return true;
}

function cancelBooking(id) {
  save(KEYS.bookings, load(KEYS.bookings).filter(b => b.id !== id));
}

/* ==========================================================================
   BOOKING PAGE UI
   Only runs on a page that has #service-picker (book.html).
   ========================================================================== */

function initBookingPage() {
  // DOM selection: every lookup on this page goes through querySelector.
  // $("name") is short for document.querySelector("#name").
  const $ = id => document.querySelector("#" + id);
  const picker = $("service-picker");
  if (!picker) return;

  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + DAYS_AHEAD);

  const state = {
    serviceId: null,
    date: null,
    time: null,
    month: new Date(today.getFullYear(), today.getMonth(), 1),
  };

  /* Step 1: services */
  function renderServices() {
    picker.innerHTML = "";
    for (const svc of SERVICES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "svc" + (state.serviceId === svc.id ? " selected" : "");
      btn.setAttribute("aria-pressed", state.serviceId === svc.id);
      btn.innerHTML = `
        <span class="svc-name">${svc.name}</span>
        <span class="svc-meta"><b class="price">${svc.price}</b> · ${svc.minutes} min</span>`;
      btn.addEventListener("click", () => {
        state.serviceId = svc.id;
        state.time = null;
        // If the chosen day no longer fits this service, clear it.
        if (state.date && availableTimes(state.date, svc.id).length === 0) state.date = null;
        renderAll();
        $("step-date").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      picker.appendChild(btn);
    }
  }

  /* Step 2: calendar */
  function dayIsBookable(key) {
    const d = parseKey(key);
    if (d < parseKey(todayKey()) || d > lastDay) return false;
    if (state.serviceId) return availableTimes(key, state.serviceId).length > 0;
    return allSlots(key).some(t => !isPast(key, t)) && !isDayOff(key);
  }

  function renderCalendar() {
    const cal = $("calendar");
    const y = state.month.getFullYear();
    const m = state.month.getMonth();

    $("month-label").textContent = state.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    $("prev").disabled = y === today.getFullYear() && m === today.getMonth();
    $("next").disabled = new Date(y, m + 1, 1) > lastDay;

    cal.innerHTML = "";
    for (const d of ["S", "M", "T", "W", "T", "F", "S"]) {
      const h = document.createElement("span");
      h.className = "cal-dow";
      h.textContent = d;
      cal.appendChild(h);
    }

    const firstWeekday = new Date(y, m, 1).getDay();
    for (let i = 0; i < firstWeekday; i++) cal.appendChild(document.createElement("span"));

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dateKey(new Date(y, m, day));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = day;
      if (key === todayKey()) btn.classList.add("today");
      if (key === state.date) btn.classList.add("selected");
      btn.disabled = !dayIsBookable(key);
      btn.setAttribute("aria-label", prettyDate(key));
      btn.addEventListener("click", () => {
        state.date = key;
        state.time = null;
        renderAll();
        $("step-time").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      cal.appendChild(btn);
    }
  }

  /* Step 3: times */
  function renderTimes() {
    const box = $("times");
    const label = $("time-label");
    box.innerHTML = "";

    if (!state.serviceId) { label.textContent = "Choose a service first."; return; }
    if (!state.date) { label.textContent = "Choose a day first."; return; }

    const times = availableTimes(state.date, state.serviceId);
    label.textContent = times.length
      ? `Open times on ${prettyDate(state.date)}:`
      : "No open times left that day. Try another day.";

    for (const t of times) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time" + (state.time === t ? " selected" : "");
      btn.textContent = prettyTime(t);
      btn.addEventListener("click", () => {
        state.time = t;
        renderTimes();
        updateSummary();
        $("step-details").scrollIntoView({ behavior: "smooth", block: "start" });
        $("name").focus({ preventScroll: true });
      });
      box.appendChild(btn);
    }
  }

  /* Step 4: summary + confirm button */
  function phoneOk() {
    return $("phone").value.replace(/\D/g, "").length >= 10;
  }

  function updateSummary() {
    const svc = getService(state.serviceId);
    $("summary").innerHTML = svc && state.date && state.time
      ? `<b>${svc.name}</b> (${svc.price}) on <b>${prettyDate(state.date)}</b> at <b>${prettyTime(state.time)}</b>`
      : "Choose a service, day and time.";

    $("confirm").disabled = !(svc && state.date && state.time && $("name").value.trim() && phoneOk());
  }

  function renderAll() {
    renderServices();
    renderCalendar();
    renderTimes();
    updateSummary();
  }

  /* Month buttons */
  $("prev").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    renderCalendar();
  });
  $("next").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    renderCalendar();
  });

  $("name").addEventListener("input", updateSummary);
  $("phone").addEventListener("input", () => {
    checkPhone();
    updateSummary();
  });

  /* Decision based on user input: is the phone number usable?
     Reads what the user typed (.value), decides with if / else if / else,
     and shows visible feedback under the form (.textContent). */
  function checkPhone() {
    const msg = $("phone-msg");
    const typed = $("phone").value.trim();
    const digits = typed.replace(/\D/g, "").length;

    if (typed === "") {
      msg.textContent = "";
      msg.className = "hint";
    } else if (digits < 10) {
      msg.textContent = `Phone number needs 10 digits (you have ${digits}).`;
      msg.className = "hint error";
    } else {
      msg.textContent = "Phone number looks good.";
      msg.className = "hint ok";
    }
  }

  /* Submit */
  $("book-form").addEventListener("submit", e => {
    e.preventDefault();
    const svc = getService(state.serviceId);
    const booking = {
      serviceId: state.serviceId,
      date: state.date,
      time: state.time,
      name: $("name").value.trim(),
      phone: $("phone").value.trim(),
      created: new Date().toISOString(),
    };

    if (!addBooking(booking)) {
      alert("Sorry, that time was just taken. Please pick another.");
      state.time = null;
      renderAll();
      return;
    }

    // Swap the steps for the confirmation card
    document.querySelectorAll(".step").forEach(el => (el.hidden = true));
    const confirmBox = $("confirmation");
    confirmBox.hidden = false;
    $("confirm-text").textContent =
      `${booking.name}, you're set for ${svc.name} on ${prettyDate(booking.date)} at ${prettyTime(booking.time)}.`;

    // Pre-filled email so Anthony actually gets the booking
    const subject = `Booking: ${svc.name} – ${prettyDate(booking.date)} ${prettyTime(booking.time)}`;
    const body =
      `Name: ${booking.name}\nPhone: ${booking.phone}\nService: ${svc.name} (${svc.price})\n` +
      `Date: ${prettyDate(booking.date)}\nTime: ${prettyTime(booking.time)}`;
    const mail = document.createElement("a");
    mail.className = "btn btn-primary";
    mail.href = `mailto:${BARBER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    mail.textContent = "Send to Anthony";
    confirmBox.insertBefore(mail, confirmBox.querySelector(".btn-ghost"));

    confirmBox.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  renderAll();
}

document.addEventListener("DOMContentLoaded", initBookingPage);