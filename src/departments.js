'use strict';

// The departments offered in the booking form, in the order they are shown.
//
// A fixed list rather than a free text box: the department is what the
// analytics group by, and typed entries drift ("General Affairs", "Gen.
// Affairs", "GA") until the same team appears as three rows. It also decides
// how far ahead someone may book, so it needs to match HR_DEPARTMENTS exactly
// rather than approximately.
//
// Managed in code like the room catalog — to add or rename one, edit this list
// and deploy. Renaming does not touch bookings already made: those keep the
// name they were filed under, which is what keeps past analytics readable.
//
// Note GA.HR is matched by HR_DEPARTMENTS, so it books 180 days ahead while
// everything else here books 90.
const DEPARTMENTS = [
  'PE',
  'EC',
  'CD',
  'PD',
  'WH',
  'QA',
  'SALES',
  'PUR',
  'ACCT',
  'BOI',
  'GA.HR',
  'IT',
];

module.exports = { DEPARTMENTS };
