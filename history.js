// routes/history.js
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Get booking history for a user
router.get('/history/:userId', async (req, res) => {
    const userId = req.params.userId;

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
                w.rate
            FROM Booking b
            JOIN Service s ON b.service_id = s.service_id
            JOIN Workshops w ON s.workshop_id = w.workshop_id
            WHERE b.user_id = $1
            ORDER BY b.booking_date DESC;
        `, [userId]);

        res.json(results.rows);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).send('Internal server error');
    }
});

module.exports = router;
