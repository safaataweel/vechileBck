
const express = require('express');
const router = express.Router();


require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");

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

// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
// Backend Route to Cancel Booking (Delete a Booking)
router.delete('/bookings/:booking_id', authenticateJWT, async (req, res) => {
    const { booking_id } = req.params;
    const userId = req.user.user_id;  // Get user from JWT token
  
    try {
      // Check if the booking exists and belongs to the user
      const bookingResult = await pool.query(
        'SELECT * FROM Booking WHERE booking_id = $1 AND user_id = $2',
        [booking_id, userId]
      );
  
      if (bookingResult.rows.length === 0) {
        return res.status(404).json({ message: 'Booking not found or you do not have permission.' });
      }
  
      // Delete the booking from the database
      await pool.query('DELETE FROM Booking WHERE booking_id = $1', [booking_id]);
      res.status(200).json({ message: 'Booking canceled successfully' });
    } catch (err) {
      console.error('Error canceling booking:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
// Route to get all bookings for a user  
router.get('/bookings', authenticateJWT, async (req, res) => {
    const userId = req.user.user_id;  // Get user from JWT token

    try {
        const results = await pool.query(
            `SELECT b.booking_id, b.booking_date, b.scheduled_date, b.completion_date, b.booking_status,
                    s.service_name, s.price, w.workshop_name, w.rate
             FROM Booking b
             JOIN Service s ON b.service_id = s.service_id
             JOIN Workshops w ON s.workshop_id = w.workshop_id
             WHERE b.user_id = $1
             ORDER BY b.booking_date DESC`,
            [userId]
        );

        res.json(results.rows);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).send('Internal server error');
    }
});

module.exports = router;