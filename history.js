// routes/history.js
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();
const jwt = require('jsonwebtoken');

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
router.get('/history', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const results = await pool.query(`
     SELECT 
      b.booking_id,
      b.booking_date,
      b.scheduled_date,
      b.completion_date,
      b.booking_status,
      s.service_name,
      s.price,
      w.workshop_name,
      w.rate,
      ml.log_id,
      ml.date AS maintenance_date,
      ml.notes
    FROM Booking b
    JOIN BookingService bs ON bs.booking_id = b.booking_id
    JOIN Service s ON s.service_id = bs.service_id
    JOIN Workshops w ON b.workshop_id = w.workshop_id
    LEFT JOIN MaintenanceLog ml ON ml.booking_id = b.booking_id
    WHERE b.user_id = $1
      AND b.booking_status IN ('complete paid', 'complete partially paid')
    ORDER BY b.booking_date DESC, ml.date DESC;
    `, [userId]);

    if (results.rows.length === 0) {
      return res.status(200).json({ message: "No history yet" });
    }

    const grouped = results.rows.reduce((acc, row) => {
      let booking = acc.find(b => b.booking_id === row.booking_id);
      if (!booking) {
        booking = {
          booking_id: row.booking_id,
          booking_date: row.booking_date,
          scheduled_date: row.scheduled_date,
          completion_date: row.completion_date,
          booking_status: row.booking_status,
          service_name: row.service_name,
          price: row.price,
          workshop_name: row.workshop_name,
          rate: row.rate,
          maintenance_logs: [],
        };
        acc.push(booking);
      }
      if (row.log_id) {
        booking.maintenance_logs.push({
          log_id: row.log_id,
          date: row.maintenance_date,
          notes: row.notes,
        });
      }
      return acc;
    }, []);

    res.status(200).json(grouped);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).send('Internal server error');
  }
});


module.exports = router;
