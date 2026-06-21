import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, WA_NUMBER } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── Cache: month key → array of slots ─── */
const _cache = new Map();

function _monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function invalidateCache(year, month) {
  _cache.delete(_monthKey(year, month));
}

/* ─── fetch all blocked slots for a given month ─── */
export async function fetchBlockedSlots(year, month) {
  const key = _monthKey(year, month);
  if (_cache.has(key)) return _cache.get(key);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  const { data, error } = await supabase
    .from('blocked_slots')
    .select('*')
    .gte('date', from)
    .lte('date', to);

  if (error) {
    console.error('Supabase fetch error:', error);
    return { error: error.message, slots: [] };
  }

  _cache.set(key, data);
  return data;
}

/* ─── helpers ─── */
export function formatDateHebrew(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function buildWhatsAppLink(dateStr, startHour, endHour) {
  const dateLabel = formatDateHebrew(dateStr);
  const text = `היי! אני רוצה לקבוע BOOM TANK לתאריך ${dateLabel} בין ${startHour}:00 ל-${endHour}:00 😊`;
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
}

/*
 * isDayFullyBlocked — returns true if the day has a slot with NULL hours
 */
export function isDayFullyBlocked(slots, dateStr) {
  return slots.some(s => s.date === dateStr && s.start_hour == null);
}

/*
 * getBlockedHoursForDay — returns Set of hours that are blocked for that day.
 * e.g. start_hour=10, end_hour=13 blocks 10, 11, 12.
 */
export function getBlockedHoursForDay(slots, dateStr) {
  const blocked = new Set();
  slots
    .filter(s => s.date === dateStr && s.start_hour != null)
    .forEach(s => {
      for (let h = s.start_hour; h < s.end_hour; h++) blocked.add(h);
    });
  return blocked;
}

/*
 * buildCalendar — renders a month calendar into `containerEl`.
 * Calls `onDayClick(dateStr)` when an available day is clicked.
 * `blockedSlots` is the array from fetchBlockedSlots.
 * `selectedDate` is a string 'YYYY-MM-DD' or null.
 */
export function buildCalendar(containerEl, year, month, blockedSlots, selectedDate, onDayClick, onFullDayClick) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthNames = [
    'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
    'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'
  ];
  const dayNames = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="calPrev" aria-label="חודש קודם">&#8250;</button>
      <span class="cal-month-label">${monthNames[month - 1]} ${year}</span>
      <button class="cal-nav" id="calNext" aria-label="חודש הבא">&#8249;</button>
    </div>
    <div class="cal-grid">
      ${dayNames.map(d => `<div class="cal-dow">${d}</div>`).join('')}
  `;

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-cell cal-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cellDate = new Date(year, month - 1, day);
    const isPast = cellDate < today;
    const isFullyBlocked = isDayFullyBlocked(blockedSlots, dateStr);
    const isSelected = dateStr === selectedDate;

    let cls = 'cal-cell';
    if (isPast) {
      cls += ' cal-disabled';
    } else if (isFullyBlocked) {
      cls += ' cal-blocked cal-blocked-clickable';
    } else {
      cls += ' cal-available';
    }
    if (isSelected) cls += ' cal-selected';

    html += `<div class="${cls}" data-date="${dateStr}" data-full="${isFullyBlocked ? '1' : ''}">${day}</div>`;
  }

  html += `</div>`;
  containerEl.innerHTML = html;

  containerEl.querySelectorAll('.cal-available').forEach(cell => {
    cell.addEventListener('click', () => onDayClick(cell.dataset.date));
  });
  if (onFullDayClick) {
    containerEl.querySelectorAll('.cal-blocked-clickable').forEach(cell => {
      cell.addEventListener('click', () => onFullDayClick(cell.dataset.date));
    });
  }
}

/*
 * buildHourPicker — renders hour range picker into `containerEl`.
 * `blockedHours` is a Set of blocked hours.
 * `onRangeSelected(start, end)` is called when both ends are picked.
 */
export function buildHourPicker(containerEl, blockedHours, onRangeSelected) {
  const START = 8;
  const END = 20;

  let selStart = null;
  let selEnd = null;

  function render() {
    let html = `<div class="hour-grid">`;
    for (let h = START; h < END; h++) {
      const isBlocked = blockedHours.has(h);
      const label = `${h}:00`;
      let cls = 'hour-cell';
      if (isBlocked) cls += ' hour-blocked';
      if (selStart !== null && selEnd !== null && h >= selStart && h < selEnd) cls += ' hour-in-range';
      if (h === selStart) cls += ' hour-start';
      if (selEnd !== null && h === selEnd - 1) cls += ' hour-end';
      html += `<div class="${cls}" data-h="${h}"${isBlocked ? '' : ' tabindex="0"'}>${label}</div>`;
    }
    html += `</div>`;

    if (selStart !== null && selEnd !== null) {
      html += `
        <div class="hour-summary">
          <span>⏱ ${selStart}:00 עד ${selEnd}:00</span>
          <button class="hour-reset">שנה בחירה</button>
        </div>
      `;
    } else if (selStart !== null) {
      html += `<p class="hour-hint">עכשיו בחר שעת סיום</p>`;
    } else {
      html += `<p class="hour-hint">בחר שעת התחלה</p>`;
    }

    containerEl.innerHTML = html;
    attachHandlers();
  }

  function attachHandlers() {
    containerEl.querySelectorAll('.hour-cell:not(.hour-blocked)').forEach(cell => {
      cell.addEventListener('click', () => {
        const h = parseInt(cell.dataset.h, 10);
        if (selStart === null) {
          selStart = h;
          selEnd = null;
        } else if (selEnd === null) {
          if (h <= selStart) {
            selStart = h;
          } else {
            selEnd = h + 1;
            onRangeSelected(selStart, selEnd);
          }
        } else {
          selStart = h;
          selEnd = null;
        }
        render();
      });
    });

    const resetBtn = containerEl.querySelector('.hour-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        selStart = null; selEnd = null;
        render();
        onRangeSelected(null, null);
      });
    }
  }

  render();
}
