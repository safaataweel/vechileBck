const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// JWT authentication middleware (اللي انت حاطه تمام)
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded; // بيانات المستخدم هنا
    next();
  });
};

// إضافة ورشة للمفضلة
router.post('/favorite', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id; // افترضنا أن الـ JWT فيه user_id
  const { workshop_id } = req.body;

  if (!workshop_id) {
    return res.status(400).json({ message: 'workshop_id is required' });
  }

  try {
    const existsQuery = 'SELECT * FROM favorite_workshops WHERE user_id = $1 AND workshop_id = $2';
    const existsResult = await pool.query(existsQuery, [userId, workshop_id]);
    if (existsResult.rows.length > 0) {
      return res.status(409).json({ message: 'Already in favorites' });
    }

    const insertQuery = 'INSERT INTO favorite_workshops (user_id, workshop_id) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(insertQuery, [userId, workshop_id]);
    res.status(201).json({ message: 'Added to favorites', favorite: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// حذف ورشة من المفضلة
router.delete('/favorite/:workshop_id', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const workshopId = req.params.workshop_id;

  try {
    const deleteQuery = 'DELETE FROM favorite_workshops WHERE user_id = $1 AND workshop_id = $2 RETURNING *';
    const result = await pool.query(deleteQuery, [userId, workshopId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Favorite not found' });
    }

    res.json({ message: 'Removed from favorites' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// جلب ورش المفضلة للمستخدم
router.get('/myfavorites', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const query = `
      SELECT w.* FROM Workshops w
      JOIN favorite_workshops f ON w.workshop_id = f.workshop_id
      WHERE f.user_id = $1
    `;
    const result = await pool.query(query, [userId]);

    res.json({ favorites: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
