
const express = require('express');
const router = express.Router();


require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
const cron = require("node-cron");
const jwt = require('jsonwebtoken');


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

async function getWorkshopUserId(workshopId) {
  const result = await pool.query('SELECT user_id FROM Workshops WHERE workshop_id = $1', [workshopId]);
  if (result.rows.length > 0) {
    return result.rows[0].user_id;
  }
  return null; // لو ما حصلتش على user_id
}
router.post('/multiple', authenticateJWT, async (req, res) => {
  const client = await pool.connect();
  const scheduledBookings = req.body.bookings;
  const { address, temporary, totalPrice } = req.body;
  const userId = req.user.user_id;

  try {
    console.log('Received booking request:', JSON.stringify(req.body, null, 2));

    await client.query('BEGIN');
    const bookingIds = [];

    for (const booking of scheduledBookings) {
      const {
        workshop_id,
        scheduled_date,
        time: scheduled_time,
        services,
        vehicle_id,
        is_mobile_service = false,
        is_pickup = false,
        pickup_fee = 0,
      } = booking;

      const workshopUserId = await getWorkshopUserId(workshop_id);

      const bookingInsertQuery = `
        INSERT INTO Booking (
          user_id, workshop_id, vehicle_id,
          status_name, booking_date, scheduled_date, scheduled_time,
          booking_status,
          address_id, temporary_street, temporary_city,
          is_mobile_service,
          is_pickup, pickup_status
        )
        VALUES (
          $1, $2, $3,
          'Not Started', CURRENT_DATE, $4, $5,
          'pending',
          $6, $7, $8,
          $9,
          $10, $11
        )
        RETURNING booking_id
      `;

      const bookingValues = [
        userId,
        workshop_id,
        vehicle_id,
        scheduled_date,
        scheduled_time,
        temporary ? null : address?.address_id,
        temporary ? address?.street : null,
        temporary ? address?.city : null,
        is_mobile_service,
        is_pickup,
        is_pickup ? 'pending' : null,
      ];

      const result = await client.query(bookingInsertQuery, bookingValues);
      const bookingId = result.rows[0].booking_id;
      bookingIds.push(bookingId);

      for (const service of services) {
        const full_price = service.price + (is_mobile_service ? service.mobile_fee : 0);
        const { service_id } = service;

        await client.query(
          `INSERT INTO BookingService 
           (booking_id, service_id, price, status, approved_by_user, added_by) 
           VALUES ($1, $2, $3, 'approved', true, 'mechanic')`,
          [bookingId, service_id, full_price]
        );
      }

      await client.query(
        `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
        [
          userId,
          workshopUserId,
          `New booking request received for your workshop!`,
          'booking_request'
        ]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ message: 'Bookings created successfully', bookingIds });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('💥 Error during booking process:', err);
    return res.status(500).json({ error: 'Something went wrong during booking' });

  } finally {
    client.release();
  }
});

router.get('/bookings', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const results = await pool.query(
      `SELECT 
  b.booking_id,
  b.booking_date,
  b.scheduled_date,
  b.scheduled_time,
  b.completion_date,
  b.booking_status,
  b.status_name,

  bs.status AS service_status, -- ← الحالة الفردية للخدمة
  bs.price,

  s.service_id,
  s.service_name,

  w.workshop_name,
  w.workshop_id,
  w.rate,
  w.image,

  v.vehicle_id,
  r.make,
  r.model,
  r.year

FROM Booking b
JOIN BookingService bs ON b.booking_id = bs.booking_id
JOIN Service s ON bs.service_id = s.service_id
JOIN Workshops w ON b.workshop_id = w.workshop_id
JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
JOIN ReferenceVehicle r ON v.reference_id = r.reference_id

WHERE b.user_id = $1
ORDER BY b.booking_date DESC
`,

      [userId]
    );

    res.json(results.rows);
    console.log('📅 Bookings fetched successfully:', results.rows);
  } catch (error) {
    console.error('💥 Error fetching bookings:', error);
    res.status(500).send('Internal server error');
  }
});

router.get("/workshop/:workshop_id/bookings", async (req, res) => {
  const { workshop_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        b.booking_id,
        b.user_id,
        u.first_name,
        u.last_name,
        u.phone_number,
        s.service_name,
        b.booking_date,
        b.scheduled_date,
        b.booking_status,
        w.workshop_name, 
        a.street AS address_street,
        a.city AS address_city,
        b.temporary_street,
        b.temporary_city
      FROM 
        Booking b
      JOIN 
        Service s ON b.service_id = s.service_id
      JOIN 
        Workshops w ON s.workshop_id = w.workshop_id
      LEFT JOIN 
        Address a ON b.address_id = a.address_id
      JOIN 
        Users u ON b.user_id = u.user_id
      WHERE 
        w.workshop_id = $1`,
      [workshop_id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ message: "No bookings yet for this workshop." });
    }

    res.status(200).json(result.rows);

  } catch (err) {
    console.error("Error fetching bookings:", err);
    res.status(500).json({ message: "Server error." });
  }
});

router.get('/booking', async (req, res) => {
  const { status, from, to } = req.query;

  let query = `
    SELECT 
      b.booking_id,
      u.first_name || ' ' || u.last_name AS customer_name,
      v.vehicle_id,
      rv.make || ' ' || rv.model || ' ' || rv.year AS vehicle_model,
      b.booking_date,
      b.scheduled_date,
      COALESCE(TO_CHAR(b.scheduled_time, 'HH24:MI'), 'Not Scheduled Yet') AS scheduled_time,
      COALESCE(TO_CHAR(b.completion_date, 'YYYY-MM-DD'), 'Not Completed Yet') AS completion_date,
      b.booking_status,
      w.workshop_id,
      w.workshop_name,
      b.temporary_street,
      b.temporary_city,
      bool_or(b.is_mobile_service) AS is_mobile_service,
      bool_or(b.is_pickup) AS is_pickup,
      json_agg(
        json_build_object(
          'service_name', s.service_name,
          'status', bs.status,
          'added_by', bs.added_by,
          'approved_by_user', bs.approved_by_user,
          'price', bs.price,
          'estimated_duration', bs.estimated_duration
        )
      ) AS services_details
    FROM Booking b
    JOIN Users u ON b.user_id = u.user_id
    JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
    JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
    JOIN BookingService bs ON b.booking_id = bs.booking_id
    JOIN Service s ON bs.service_id = s.service_id
    JOIN Workshops w ON s.workshop_id = w.workshop_id
  `;

  const conditions = [];
  const values = [];

  if (status) {
    values.push(status);
    conditions.push(`b.booking_status = $${values.length}`);
  }

  if (from) {
    values.push(from);
    conditions.push(`b.booking_date >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    conditions.push(`b.booking_date <= $${values.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += `
    GROUP BY 
      b.booking_id, u.first_name, u.last_name, v.vehicle_id,
      rv.make, rv.model, rv.year,
      b.booking_date, b.scheduled_date, b.scheduled_time, b.completion_date,
      b.booking_status, w.workshop_id, w.workshop_name,
      b.temporary_street, b.temporary_city
    ORDER BY b.booking_date DESC
  `;

  try {
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.get('/Mechanic/bookings', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id; // خذ user_id من التوكن
    console.log(userId);
    // جلب workshop_id المرتبط بهذا user_id
    const workshopResult = await pool.query('SELECT workshop_id FROM Workshops WHERE user_id = $1', [userId]);
    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }
    const workshopId = workshopResult.rows[0].workshop_id;
    console.log('Workshop ID:', workshopId);

    const query = `
     SELECT 
   b.booking_id,
   b.booking_date,
   b.scheduled_date,
   b.scheduled_time,
   b.completion_date,
   b.booking_status,
   b.status_name,
   b.workshop_id,
   s.service_id,
   s.service_name,
   bs.price,
   w.workshop_name,
   w.rate,
   w.image,
   v.vehicle_id,
   r.make,
   r.model,
   r.year,
   u.first_name,
   u.last_name ,
   u.phone_number
FROM Booking b
JOIN BookingService bs ON b.booking_id = bs.booking_id
JOIN Service s ON bs.service_id = s.service_id
JOIN Workshops w ON b.workshop_id = w.workshop_id
JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
JOIN ReferenceVehicle r ON v.reference_id = r.reference_id
JOIN Users u ON b.user_id = u.user_id
WHERE b.workshop_id = $1
ORDER BY b.booking_date DESC

    `;

    const { rows } = await pool.query(query, [workshopId]);
    res.json({ bookings: rows });
  } catch (error) {
    console.error('Error fetching workshop bookings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/status', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id; // خذ user_id من التوكن
  console.log(userId);
  const bookingId = req.params.id;
  console.log(bookingId)
  const workshopResult = await pool.query('SELECT workshop_id FROM Workshops WHERE user_id = $1', [userId]);
  if (workshopResult.rows.length === 0) {
    return res.status(400).json({ message: 'Workshop not found for this user' });
  }
  const workshopId = workshopResult.rows[0].workshop_id;
  console.log('Workshop ID:', workshopId);

  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be "accepted" or "rejected"' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // تحقق من الحجز
    const bookingResult = await client.query(
      `SELECT b.user_id AS customer_id, w.user_id AS workshop_user_id
       FROM Booking b
       JOIN Workshops w ON b.workshop_id = w.workshop_id
       WHERE b.booking_id = $1 AND b.workshop_id = $2`,
      [bookingId, workshopId]
    );

    if (bookingResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found or unauthorized' });
    }

    const { customer_id, workshop_user_id } = bookingResult.rows[0];

    // تحديث حالة الحجز
    await client.query(
      `UPDATE Booking SET booking_status = $1 WHERE booking_id = $2`,
      [status, bookingId]
    );

    // إرسال الإشعار للزبون
    const message = status === 'accepted'
      ? `Booking #${bookingId} has been accepted by the workshop`
      : `Booking #${bookingId} has been rejected by the workshop`;

    await client.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        workshop_user_id,  // المرسل هو الورشة (بصورة user_id)
        customer_id,       // المستلم هو الزبون
        message,
        'booking status update'
      ]
    );

    await client.query('COMMIT');

    res.json({ message: `Booking status updated and notification sent to customer.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  } finally {
    client.release();
  }
});

router.get('/Mechanic/bookings/today', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id;
    console.log('User ID today:', userId);

    // Get workshop_id based on user_id
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;
    console.log('Workshop ID today:', workshopId);

    const query = `
  SELECT 
     b.booking_id,
     b.booking_date,
     b.scheduled_date,
     b.scheduled_time,
     b.completion_date,
     b.booking_status,
     b.status_name,
     b.workshop_id,
     s.service_id,
     s.service_name,
     bs.status AS service_status,  -- ✅ هذا السطر اللي أضفناه
    bs.approved_by_user,          -- (اختياري) لو بدك كمان ترجع حالة الموافقة
    bs.price,
     v.vehicle_id,
     r.make,
     r.model,
     r.year,
     u.first_name,
     u.last_name
  FROM Booking b
  JOIN BookingService bs ON b.booking_id = bs.booking_id
  JOIN Service s ON bs.service_id = s.service_id
  JOIN Workshops w ON b.workshop_id = w.workshop_id
  JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
  JOIN ReferenceVehicle r ON v.reference_id = r.reference_id
  JOIN Users u ON b.user_id = u.user_id
  WHERE 
    b.workshop_id = $1 
    AND b.scheduled_date = CURRENT_DATE
AND b.booking_status NOT IN ('rejected')
  ORDER BY b.scheduled_date ASC
`;


    const { rows } = await pool.query(query, [workshopId]);
    console.log('Today\'s bookings:', rows);
    res.json({ bookings: rows });
  } catch (error) {
    console.error('Error fetching today\'s bookings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel Booking by Workshop & Send Notification to Customer
// Cancel Booking by Workshop (Mechanic) - update status and reason
router.patch('/mechanic/bookings/:booking_id/cancel', authenticateJWT, async (req, res) => {
  const { booking_id } = req.params;
  const workshopUserId = req.user.user_id; // الورشة اللي داخله حاليا
  const { cancellation_reason } = req.body || null; // ممكن ما يرسل سبب

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // نحصل على workshop_id المرتبط بهذا المستخدم
    const workshopResult = await client.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [workshopUserId]
    );

    if (workshopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // نتحقق إذا الحجز فعلاً مرتبط بهي الورشة
    const bookingResult = await client.query(
      'SELECT booking_id, user_id, booking_status FROM Booking WHERE booking_id = $1 AND workshop_id = $2',
      [booking_id, workshopId]
    );

    if (bookingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found or does not belong to your workshop.' });
    }

    const booking = bookingResult.rows[0];

    // ما نسمح نلغي الحجز لو هو مكتمل أو ملغي أصلاً
    if (booking.booking_status === 'completed' || booking.booking_status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot cancel a completed or already cancelled booking.' });
    }

    // تحديث حالة الحجز بدل حذفه مع حفظ سبب الإلغاء والتوقيت والجهة اللي ألغت
    await client.query(
      `UPDATE Booking SET
        booking_status = 'cancelled',
        cancellation_reason = $1,
        cancellation_by = 'mechanic',
        cancelled_at = CURRENT_TIMESTAMP
       WHERE booking_id = $2`,
      [cancellation_reason, booking_id]
    );

    // إرسال إشعار للزبون
    await client.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        workshopUserId,
        booking.user_id,
        `⚠️ Your booking #${booking_id} was cancelled by the workshop. Reason: ${cancellation_reason || 'No reason provided'}.`,
        'booking_cancelled'
      ]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Booking cancelled by workshop successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cancelling booking by workshop:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/Mechanic/bookings/:bookingId/delay', authenticateJWT, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { delayMinutes } = req.body;

    // جلب وقت الحجز الحالي وعدد التأجيلات
    const result = await pool.query(
      'SELECT scheduled_time, user_id, delay_count FROM Booking WHERE booking_id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const { scheduled_time, user_id, delay_count } = result.rows[0];

    // تحقق من عدد التأجيلات
    if (delay_count >= 2) {
      return res.status(400).json({ message: 'Sorry, you can only delay the booking twice.' });
    }

    // تحويل الوقت إلى كائن Date مع تاريخ وهمي
    const [hours, minutes, seconds] = scheduled_time.split(':').map(Number);
    const now = new Date();
    const newTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes + delayMinutes,
      seconds || 0
    );

    const formattedTime = newTime.toTimeString().split(' ')[0]; // "HH:MM:SS"

    // تحديث الوقت وعدد التأجيلات في قاعدة البيانات
    await pool.query(
      'UPDATE Booking SET scheduled_time = $1, delay_count = delay_count + 1 WHERE booking_id = $2',
      [formattedTime, bookingId]
    );

    const mechanicId = req.user.user_id;
    const notificationMessage = `⏱ Your appointment has been delayed by ${delayMinutes} minutes. New time: ${formattedTime.slice(0, 5)}`;

    await pool.query(
      `INSERT INTO Notification 
        (sender_user_id, receiver_user_id, message, date, notification_type, is_read)
       VALUES ($1, $2, $3, $4, 'booking_delay', false)`,
      [mechanicId, user_id, notificationMessage, now]
    );

    res.status(200).json({ message: 'Booking time updated and user notified.' });
  } catch (error) {
    console.error('Delay Booking Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/Mechanic/bookings/pending', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id;
    console.log('User ID:', userId);

    // جلب workshop_id المرتبط بهذا user_id
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;
    console.log('Workshop ID:', workshopId);

    const query = `
      SELECT 
        b.booking_id,
        b.booking_date,
        b.scheduled_date,
        b.scheduled_time,
        b.completion_date,
        b.booking_status,
        s.service_id,
        s.service_name,
        bs.price,
        w.workshop_name,
        w.rate,
        w.image,
        v.vehicle_id,
        r.make,
        r.model,
        r.year,
        u.first_name,
        u.last_name,
        u.phone_number
      FROM Booking b
      JOIN BookingService bs ON b.booking_id = bs.booking_id
      JOIN Service s ON bs.service_id = s.service_id
      JOIN Workshops w ON b.workshop_id = w.workshop_id
      JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
      JOIN ReferenceVehicle r ON v.reference_id = r.reference_id
      JOIN Users u ON b.user_id = u.user_id
      WHERE 
  b.workshop_id = $1
  AND b.booking_status = 'pending'

      ORDER BY b.scheduled_date ASC, b.scheduled_time ASC
    `;

    const { rows } = await pool.query(query, [workshopId]);
    res.json({ bookings: rows });
    console.log('Pending bookings fetched successfully:', rows.length);
    console.log('Pending bookings:', rows);
  } catch (error) {
    console.error("Error fetching pending bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
});
router.get('/Mechanic/bookings/pending/count', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    const countQuery = `
      SELECT COUNT(*) AS pending_count
      FROM Booking b
      WHERE 
        b.workshop_id = $1
        AND b.booking_status = 'pending'
        AND (b.scheduled_date > CURRENT_DATE OR (b.scheduled_date = CURRENT_DATE AND b.scheduled_time > CURRENT_TIME))
    `;

    const { rows } = await pool.query(countQuery, [workshopId]);

    res.json({ pendingBookingsCount: parseInt(rows[0].pending_count, 10) });
  } catch (error) {
    console.error("Error fetching pending bookings count:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch('/update/:id', authenticateJWT, async (req, res) => {
  const bookingId = req.params.id;
  const { scheduled_date, scheduled_time } = req.body;

  if (!scheduled_date && !scheduled_time) {
    return res.status(400).json({ message: 'Provide scheduled_date or scheduled_time to update' });
  }

  try {
    // 1. تحقق من الحجز وملكيته
    const bookingResult = await pool.query(
      'SELECT scheduled_date, scheduled_time, user_id FROM Booking WHERE booking_id = $1',
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (booking.user_id !== req.user.user_id) {
      return res.status(403).json({ message: 'Not authorized to edit this booking' });
    }

    // 2. تحقق من الوقت: لازم يكون التعديل قبل بـ 12 ساعة على الأقل
    const currentDateTime = new Date();
    const originalDateTime = new Date(`${booking.scheduled_date}T${booking.scheduled_time}`);
    const timeDiff = originalDateTime.getTime() - currentDateTime.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < 12) {
      return res.status(400).json({ message: 'Cannot update booking less than 12 hours before appointment' });
    }

    // 3. تحديث البيانات
    const updateFields = [];
    const values = [];
    let idx = 1;

    if (scheduled_date) {
      updateFields.push(`scheduled_date = $${idx++}`);
      values.push(scheduled_date);
    }
    if (scheduled_time) {
      updateFields.push(`scheduled_time = $${idx++}`);
      values.push(scheduled_time);
    }

    values.push(bookingId); // للحيث WHERE

    const updateQuery = `
      UPDATE Booking 
      SET ${updateFields.join(', ')} 
      WHERE booking_id = $${idx}
    `;

    await pool.query(updateQuery, values);

    return res.status(200).json({ message: 'Booking updated successfully' });
  } catch (err) {
    console.error('Error updating booking:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});
// update booking status send notification to customer
router.patch('/update/status/:id', authenticateJWT, async (req, res) => {
  const bookingId = req.params.id;
  const { status } = req.body;
  const userId = req.user.user_id;

  try {
    // 1. جيب الـ workshop_id تبع صاحب التوكن
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );
    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }
    const workshopId = workshopResult.rows[0].workshop_id;

    // 2. تحقق من وجود الحجز وملكيته
    const bookingResult = await pool.query(
      'SELECT workshop_id, user_id FROM Booking WHERE booking_id = $1',
      [bookingId]
    );
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.workshop_id !== workshopId) {
      return res.status(403).json({ message: 'Not authorized to edit this booking' });
    }

    // 3. تحديث status_name
    await pool.query(
      'UPDATE Booking SET status_name = $1 WHERE booking_id = $2',
      [status, bookingId]
    );

    // ✅ إذا كانت الحالة مكتملة، حدّث booking_status كمان
    if (status === 'completed') {
      await pool.query(
        'UPDATE Booking SET booking_status = $1 WHERE booking_id = $2',
        ['complete partially paid', bookingId]
      );
    }

    // 4. إرسال إشعار للزبون
    const notificationMessage =
      status === 'completed'
        ? `🚗 Your car is ready for pickup! Service #${bookingId} has been completed. Please proceed with payment when convenient.`
        : `🛠️ Your car is now under maintenance! We’ve started working on service #${bookingId}.`;

    await pool.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        userId,
        booking.user_id, // الزبون
        notificationMessage,
        'booking_status_update'
      ]
    );

    return res.status(200).json({ message: 'Booking status updated and notification sent.' });

  } catch (err) {
    console.error('Error updating booking status:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// update booking services (add services)
router.patch('/update/services/:id', authenticateJWT, async (req, res) => {
  const bookingId = req.params.id;
  const { services } = req.body;
  const userId = req.user.user_id;

  try {
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );
    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }
    const workshopId = workshopResult.rows[0].workshop_id;

    const bookingResult = await pool.query(
      'SELECT workshop_id FROM Booking WHERE booking_id = $1',
      [bookingId]
    );
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    if (bookingResult.rows[0].workshop_id !== workshopId) {
      return res.status(403).json({ message: 'Not authorized to edit this booking' });
    }

    // تحقق من صحة الـ service_id
    const validServiceResult = await pool.query(
      'SELECT service_id FROM Service WHERE workshop_id = $1',
      [workshopId]
    );
    const validServiceIds = validServiceResult.rows.map(r => r.service_id);
    for (const service of services) {
      if (!validServiceIds.includes(service.service_id)) {
        return res.status(400).json({ message: `Invalid service ID: ${service.service_id}` });
      }
    }


    for (const service of services) {
      const { service_id, price } = service;
      await pool.query(
        `INSERT INTO BookingService (booking_id, service_id, price, added_by, approved_by_user)
     VALUES ($1, $2, $3, 'mechanic', FALSE)`,
        [bookingId, service_id, price]
      );
    }

    // إرسال إشعار للزبون
    const notificationMessage = `🔧 New services have been added to your booking #${bookingId}. Please check your booking details for approve or reject.`;
    await pool.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        userId,
        bookingResult.rows[0].user_id, // الزبون
        notificationMessage,
        'booking_services_added'
      ]
    );
    console.log('Booking services updated successfully');
    return res.status(200).json({ message: 'Booking services updated successfully' });

  } catch (err) {
    console.error('Error updating booking services:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});
router.post('/report/:bookingId', authenticateJWT, async (req, res) => {
  const { bookingId } = req.params;
  const { report_text, total_amount, services, addition_price = 0 } = req.body; // 🆕 أضفنا addition_price
  const userId = req.user.user_id;

  try {
    const bookingResult = await pool.query(
      'SELECT user_id, workshop_id FROM Booking WHERE booking_id = $1',
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );
    if (workshopResult.rows.length === 0) {
      return res.status(400).json({ message: 'Workshop not found for this user' });
    }

    await pool.query(
      `INSERT INTO BookingReport 
      (booking_id, created_by, report_text, total_amount, services, approved_by_user, addition_price)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [bookingId, userId, report_text, total_amount, JSON.stringify(services), false, addition_price]
    );

    await pool.query(
      `INSERT INTO Notification 
      (sender_user_id, receiver_user_id, message, date, notification_type)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        userId,
        bookingResult.rows[0].user_id,
        `A new report has been created for booking #${bookingId}. Please check the details.`,
        'booking_report'
      ]
    );

    return res.status(201).json({ message: 'Report created successfully' });

  } catch (err) {
    console.error('Error creating report:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});


router.patch('/user/approve/service/:bookingId', authenticateJWT, async (req, res) => {
  const bookingId = req.params.bookingId;
  const { service_id, approve } = req.body; // approve: true or false
  const userId = req.user.user_id;
  console.log('User ID:', userId);
  console.log('Booking ID:', bookingId);
  console.log('Service ID:', service_id);

  try {
    // 1. تحقق إن المستخدم هو صاحب الحجز
    const bookingRes = await pool.query(
      'SELECT * FROM Booking WHERE booking_id = $1 AND user_id = $2',
      [bookingId, userId]
    );
    if (bookingRes.rows.length === 0) {
      return res.status(403).json({ message: 'You are not authorized to update this booking.' });
    }

    // 2. تحقق من وجود الخدمة المطلوبة وحالتها requested
    const serviceRes = await pool.query(
      'SELECT * FROM BookingService WHERE booking_id = $1 AND service_id = $2 AND status = $3',
      [bookingId, service_id, 'requested']
    );
    if (serviceRes.rows.length === 0) {
      return res.status(404).json({ message: 'Requested service not found.' });
    }

    // 3. تحديث الحالة بناءً على موافقة المستخدم
    const newStatus = approve ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE BookingService SET status = $1, approved_by_user = $2 WHERE booking_id = $3 AND service_id = $4',
      [newStatus, approve, bookingId, service_id]
    );

    // 4. إرسال إشعار للورشة
    const workshopId = bookingRes.rows[0].workshop_id;

    const workshopUserRes = await pool.query(
      'SELECT user_id FROM Workshops WHERE workshop_id = $1',
      [workshopId]
    );
    const mechanicUserId = workshopUserRes.rows[0].user_id;

    const message = approve
      ? `✅ Customer approved the requested service #${service_id} for booking #${bookingId}.`
      : `❌ Customer rejected the requested service #${service_id} for booking #${bookingId}.`;

    await pool.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        userId,
        mechanicUserId,
        message,
        'user_service_response'
      ]
    );

    return res.status(200).json({ message: `Service ${newStatus} by user.` });

  } catch (err) {
    console.error('Error approving service by user:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});


// cancel booking by user - update status and reason
router.patch('/user/cancel/:bookingId', authenticateJWT, async (req, res) => {
  const bookingId = req.params.bookingId;
  const userId = req.user.user_id;
  const { cancellation_reason } = req.body || null; // ممكن ما يرسل سبب

  try {
    // 1. تحقق من وجود الحجز وملكيته
    const bookingRes = await pool.query(
      'SELECT * FROM Booking WHERE booking_id = $1 AND user_id = $2',
      [bookingId, userId]
    );
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found or does not belong to you.' });
    }

    const booking = bookingRes.rows[0];

    // 2. تحقق من حالة الحجز، إذا مكتمل أو ملغي سابقًا
    if (booking.booking_status === 'completed' || booking.booking_status === 'cancelled') {
      return res.status(400).json({ message: 'Cannot cancel a completed or already cancelled booking.' });
    }

    // 3. حدث حالة الحجز بدل حذفه مع حفظ سبب الإلغاء والتوقيت
    await pool.query(
      `UPDATE Booking SET
        booking_status = 'cancelled',
        cancellation_reason = $1,
        cancellation_by = 'user',
        cancelled_at = CURRENT_TIMESTAMP
       WHERE booking_id = $2`,
      [cancellation_reason, bookingId]
    );

    // 4. إرسال إشعار للورشة
    const workshopId = booking.workshop_id;
    const workshopUserRes = await pool.query(
      'SELECT user_id FROM Workshops WHERE workshop_id = $1',
      [workshopId]
    );
    const mechanicUserId = workshopUserRes.rows[0].user_id;

    await pool.query(
      `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [
        userId,
        mechanicUserId,
        `🚫 Customer has cancelled the booking #${bookingId}. Reason: ${cancellation_reason || 'No reason provided'}.`,
        'booking_cancelled'
      ]
    );

    return res.status(200).json({ message: 'Booking cancelled successfully.' });

  } catch (err) {
    console.error('Error cancelling booking by user:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;