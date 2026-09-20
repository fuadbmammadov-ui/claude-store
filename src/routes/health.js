const express = require('express');
const router = express.Router();
const prisma = require('../config/db');

const DB_CHECK_TIMEOUT_MS = 2000;

router.get('/', async (req, res) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db health check timeout')), DB_CHECK_TIMEOUT_MS)
      ),
    ]);
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

module.exports = router;
