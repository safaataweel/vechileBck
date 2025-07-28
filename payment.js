const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const jwt = require('jsonwebtoken'); // تأكد من استيراد jwt

// PostgreSQL Pool setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// JWT authentication middleware
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

router.get('/payment', async (req, res) => {
  try {
    const result = await pool.query(`
        SELECT 
          p.payment_id,
          p.income_value AS amount,
          p.date AS date,
          p.status,
          p.refund_requested,
          p.refund_approved,
        CONCAT(u.first_name, ' ', u.last_name) AS customer_name
        FROM Payment p
        JOIN Booking b ON p.booking_id = b.booking_id
        JOIN Users u ON b.user_id = u.user_id
      `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

//get payment by id
router.get('/payment/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM Payment WHERE payment_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

router.put('/payment/:id/refund-approve', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE Payment SET refund_approved = TRUE, status = 'refunded' WHERE payment_id = $1`,
      [id]
    );
    res.status(200).json({ message: 'Refund approved' });
  } catch (error) {
    console.error('Error approving refund:', error);
    res.status(500).json({ error: 'Failed to approve refund' });
  }
});


router.post('/payments', authenticateJWT, async (req, res) => {
  const { booking_id, income_value, percent_to_admin, percent_to_workshop, type, payment_status ,total_price } = req.body;
  const userId = req.user.user_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // جلب بيانات الحجز وورشة العمل
    const bookingResult = await client.query(
      `SELECT b.*, w.user_id AS workshop_user_id 
       FROM Booking b 
       JOIN Workshops w ON b.workshop_id = w.workshop_id 
       WHERE b.booking_id = $1`,
      [booking_id]
    );

    if (bookingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    const workshopUserId = booking.workshop_user_id;

    // إضافة سجل الدفع
    await client.query(
      `INSERT INTO Payment (booking_id, income_value, percent_to_admin, percent_to_workshop, date, type, payment_status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)`,
      [booking_id, income_value, percent_to_admin, percent_to_workshop, type, payment_status]
    );

    // حساب المبلغ المدفوع الجديد
    const newAmountPaid = booking.amount_paid + income_value;

    // تحديد حالة الحجز حسب الدفع
    let newBookingStatus = booking.booking_status;
    const totalBookingPrice = total_price; // تأكد من أن هذا الحقل موجود في جدول الحجز
    console.log(`Total Booking Price: ${totalBookingPrice}, New Amount Paid: ${newAmountPaid}`);

    // اذا دفع كامل أو المبلغ المدفوع صار يساوي أو أكبر من السعر الكلي
    if (payment_status === 'final' && booking.booking_status == 'accepted') {
      newBookingStatus = 'accepted paid';
    } else if (newAmountPaid >= totalBookingPrice) {
      newBookingStatus = 'complete paid';
      // تحديث completion_date بتاريخ اليوم عند الدفع النهائي
      await client.query(
    `UPDATE Booking SET completion_date = CURRENT_DATE WHERE booking_id = $1`,
    [booking_id]
  );

  await client.query(
    `INSERT INTO MaintenanceLog (booking_id, vehicle_id, date, notes)
     VALUES ($1, $2, CURRENT_DATE, $3)`,
    [booking_id, booking.vehicle_id, `Maintenance log created for booking #${booking_id}`]
  );
} else {
  newBookingStatus = 'accepted partially paid';
}

    // تحديث جدول الحجز
    await client.query(
      `UPDATE Booking SET amount_paid = $1, booking_status = $2 WHERE booking_id = $3`,
      [newAmountPaid, newBookingStatus, booking_id]
    );

    // إرسال إشعارات للعميل والورشة
    await client.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type, target_group, is_read)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'customer', false)`,
      [
        workshopUserId,
        userId,
        `Your payment of ₪${income_value} has been received and confirmed. ✅`,
        'payment'
      ]
    );

    await client.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type, target_group, is_read)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'workshop', false)`,
      [
        userId,
        workshopUserId,
        `Customer has made a payment of ₪${income_value} for booking #${booking_id}. 💰`,
        'payment'
      ]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Payment processed and notifications sent successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing payment:', error);
    res.status(500).json({ message: 'Internal server error during payment process' });
  } finally {
    client.release();
  }
});

module.exports = router;