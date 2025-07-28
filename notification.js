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


// JWT authentication middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded; // Store user info in request for further use
    next();
  });
};

// جلب الإشعارات الخاصة بالمستخدم
router.get('/notifications', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const result = await pool.query(
      `SELECT notification_id, sender_user_id, message, date, notification_type
       FROM Notification
       WHERE receiver_user_id = $1
       ORDER BY date DESC`,
      [userId]
    );

    return res.status(200).json({ notifications: result.rows });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});


// Get unread count for user
router.get('/notifications/unread-count/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT COUNT(*) FROM Notification WHERE receiver_user_id = $1 AND is_read = FALSE`,
            [userId]
        );
        res.status(200).json({ unreadCount: parseInt(result.rows[0].count, 10) });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch unread count" });
    }
});
// When booking status changes:
async function onBookingStatusChange(bookingId, newStatus) {
    const booking = await getBookingDetails(bookingId);
    const customerId = booking.customer_id;
    const workshopId = booking.workshop_id;

    const message = `Your booking status changed to "${newStatus}"`;

    await pool.query(
        `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
     VALUES ($1, $2, $3, NOW(), $4)`,
        [workshopId, customerId, message, "status_update"]
    );
}

// When payment done:
async function onPaymentSuccess(paymentId) {
    const payment = await getPaymentDetails(paymentId);
    const customerId = payment.customer_id;
    const workshopId = payment.workshop_id;

    const message = `Payment of $${payment.amount} successful! Thank you.`;

    // Notify customer
    await pool.query(
        `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
     VALUES ($1, $2, $3, NOW(), $4)`,
        [workshopId, customerId, message, "payment"]
    );

    // Optionally notify workshop admin too
}

// Scheduled reminder for bookings:
cron.schedule('0 8 * * *', async () => {  // Every day at 8am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await pool.query(
        `SELECT * FROM Bookings WHERE booking_date = $1`,
        [tomorrow.toISOString().slice(0, 10)]
    );

    for (const booking of bookings.rows) {
        const message = `Reminder: Your booking is tomorrow at ${booking.preferred_time}`;
        await pool.query(
            `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, NOW(), $4)`,
            [booking.workshop_id, booking.customer_id, message, "booking_reminder"]
        );
    }
});
// Mark notification as read:
router.post('/notifications/mark-as-read', async (req, res) => {
    const { notificationId } = req.body;
    try {
        await pool.query(
            `UPDATE Notification SET is_read = TRUE WHERE notification_id = $1`,
            [notificationId]
        );
        res.status(200).json({ message: "Notification marked as read" });
    } catch (err) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
});
// Fetch notifications for a user:
router.get('/notifications/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM Notification WHERE receiver_user_id = $1 ORDER BY date DESC`,
            [userId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});
// Fetch notifications for a user with pagination:
router.get('/notifications/:userId/:page', async (req, res) => {
    const { userId, page } = req.params;
    const limit = 10; // Number of notifications per page
    const offset = (page - 1) * limit;

    try {
        const result = await pool.query(
            `SELECT * FROM Notification WHERE receiver_user_id = $1 ORDER BY date DESC LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});


module.exports = router;