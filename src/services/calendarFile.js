'use strict';

// Turning a booking into the .ics file Outlook (and Google Calendar, and a
// phone) opens as an appointment.
//
// Times are written as "floating" local times — no time zone, no trailing Z.
// A floating time means "09:00 wherever you are", which is exactly what a
// booking for a room in the building means, and it is what the rest of the app
// already stores. The alternative, a TZID, drags in a VTIMEZONE block with
// daylight-saving rules to be correct; Thailand has none, everyone reading the
// file is in the same office, and a wrong VTIMEZONE shifts meetings by an hour.

const PRODID = '-//Meeting Room Booking//EN';

// Escape the four characters that mean something in a property value.
function esc(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Content lines are limited to 75 octets; longer ones continue on the next line
// starting with a single space. Folding on characters rather than bytes is
// close enough while the content stays ASCII-ish, and over-folding is harmless.
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

// "2026-08-06T09:00" -> "20260806T090000"
function stamp(local) {
  return `${local.slice(0, 10).replace(/-/g, '')}T${local.slice(11, 16).replace(':', '')}00`;
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildIcs(booking, { host } = {}) {
  const parts = [];
  if (booking.purpose) parts.push(booking.purpose);
  parts.push(`Room: ${booking.room_name}`);
  parts.push(`Booked by: ${booking.reserver} (${booking.department})`);
  if (booking.meeting_url) parts.push(`Join: ${booking.meeting_url}`);
  const description = parts.join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable across re-downloads, so opening the file twice updates the same
    // appointment instead of creating a second one.
    `UID:booking-${booking.id}@${esc(host || 'meeting-room-booking')}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${stamp(booking.start_at)}`,
    `DTEND:${stamp(booking.end_at)}`,
    `SUMMARY:${esc(booking.purpose || `${booking.department} meeting`)}`,
    `LOCATION:${esc(booking.room_name)}`,
    `DESCRIPTION:${esc(description)}`,
    `ORGANIZER;CN=${esc(booking.reserver)}:mailto:noreply@invalid`,
  ];

  for (const p of booking.participants || []) {
    lines.push(
      `ATTENDEE;CN=${esc(p.name)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${esc(p.email)}`
    );
  }
  if (booking.meeting_url) lines.push(`URL:${esc(booking.meeting_url)}`);

  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
