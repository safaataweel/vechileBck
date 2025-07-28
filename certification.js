// GET /vehicles/:userId?type=garage OR type=customer
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  console.log('Token received:', token);

  if (!token) {
    console.log('Authorization header missing or token not found');
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('JWT verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
};
router.post('/certifications', authenticateJWT, async (req, res) => {
  const { workshop_id, name, issuing_authority, issue_date, valid_until, document_url } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO Certifications (name, issuing_authority, issue_date, valid_until, document_url, workshop_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, issuing_authority, issue_date, valid_until, document_url, workshop_id]
    );

    res.status(201).json(result.rows[0]);  // Send back the new certification
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add certification' });
  }
});
// Get certifications by workshop
router.get('/certifications/by-workshop/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT certification_id, name, issuing_authority, issue_date, valid_until, document_url
      FROM Certifications
      WHERE workshop_id = $1
    `, [id]);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch certifications' });
  }
});


// Delete
// Delete a certification
router.delete('/certifications/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM Certifications WHERE certification_id = $1`, [id]);

    res.status(200).json({ message: 'Certification deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete certification' });
  }
});

module.exports = router;