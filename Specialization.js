const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const jwt = require('jsonwebtoken');

// PostgreSQL Pool setup
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

router.get('/workshops/specializations', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id; // assuming your JWT payload has `userId`
  console.log('User ID from token:', userId); // Log the user ID for debugging
  try {
    // First, get the workshop_id using the user_id
    const workshopRes = await pool.query(
      `SELECT workshop_id FROM Workshops WHERE user_id = $1`,
      [userId]
    );

    if (workshopRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workshop not found for this user' });
    }

    const workshopId = workshopRes.rows[0].workshop_id;

    const specQuery = `
      SELECT s.specialization_id, s.name, s.description
      FROM Specializations s
      JOIN WorkshopSpecializations ws ON s.specialization_id = ws.specialization_id
      WHERE ws.workshop_id = $1
      ORDER BY s.name;
    `;

    const { rows } = await pool.query(specQuery, [workshopId]);

    res.json({ specializations: rows });
  } catch (err) {
    console.error('Error fetching specializations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/workshops/specializations', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { specialization_ids } = req.body;

  if (!Array.isArray(specialization_ids) || specialization_ids.length === 0) {
    return res.status(400).json({ error: 'specialization_ids must be a non-empty array' });
  }

  const validSpecializationIds = specialization_ids
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id));

  if (validSpecializationIds.length !== specialization_ids.length) {
    return res.status(400).json({ error: 'specialization_ids must contain only valid integers' });
  }

  try {
    // Get the workshop_id using the user_id
    const workshopRes = await pool.query(
      `SELECT workshop_id FROM Workshops WHERE user_id = $1`,
      [userId]
    );

    if (workshopRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workshop not found for this user' });
    }

    const workshopId = workshopRes.rows[0].workshop_id;

    const values = validSpecializationIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    const query = `
      INSERT INTO WorkshopSpecializations (workshop_id, specialization_id)
      VALUES ${values}
      ON CONFLICT DO NOTHING;
    `;

    await pool.query(query, [workshopId, ...validSpecializationIds]);

    res.json({ message: 'Specializations added successfully' });
  } catch (err) {
    console.error('Error adding specializations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /specializations — get all specializations
router.get('/specializations', async (req, res) => {
  try {
    const result = await pool.query('SELECT specialization_id, name, description FROM Specializations ORDER BY name');
    res.json({
      specializations: result.rows,
    });
  } catch (error) {
    console.error('Error fetching specializations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
module.exports = router;