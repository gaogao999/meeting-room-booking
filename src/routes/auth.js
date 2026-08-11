'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

// Who is logged in. The frontend uses this to prefill the department, name and
// mailbox on the booking form.
router.get('/me', (req, res) => {
  res.json({
    name: req.user?.name || '',
    department: req.user?.department || '',
    email: req.user?.email || '',
    mode: req.user?.mode || config.auth.mode,
  });
});

module.exports = router;
