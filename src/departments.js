'use strict';

// The departments offered in the booking form.
//
// A fixed list rather than a free text box: the department is what the
// analytics group by, and typed entries drift ("General Affairs", "Gen.
// Affairs", "GA") until the same team shows up as three rows. It also decides
// how far ahead someone may book, so it needs to match HR_DEPARTMENTS exactly
// rather than approximately.
//
// Managed in code like the room catalog — to add or rename one, edit this list
// and deploy. Order is the order shown in the dropdown.
const DEPARTMENTS = [
  'Engineering',
  'Production Control',
  'Quality Assurance',
  'Maintenance',
  'Sales',
  'General Affairs',
  'Human Resources',
];

module.exports = { DEPARTMENTS };
