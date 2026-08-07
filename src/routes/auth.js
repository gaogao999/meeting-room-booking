'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

// Who is logged in. The frontend uses this to prefill the department and name
// on the booking form.
router.get('/me', (req, res) => {
  res.json({
    name: req.user?.name || '',
    department: req.user?.department || '',
    mode: req.user?.mode || config.auth.mode,
  });
});

module.exports = router;
