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
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * (Math.PI / 180);
  const R = 6371; // km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in km
}

// get all emergency services
router.get('/emergencyService', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM EmergencyService`
    );
    return res.status(200).json({ emergencyServices: result.rows });
  } catch (err) {
    console.error('Error fetching emergency services:', err);
    return res.status(500).json({ error: 'Failed to fetch emergency services' });
  }
});

// add emergency service to the workshop
router.post('/emergency', authenticateJWT, async (req, res) => {
  const { workshopId, emergency_service_id, price } = req.body;
  const userId = req.user.user_id;
  console.log('Adding emergency service:', { workshopId, emergency_service_id, price, userId });

  try {
    // Check if the user is authorized to add services to this workshop
    const workshopCheck = await pool.query(
      `SELECT * FROM Workshops WHERE workshop_id = $1 AND user_id = $2`,
      [workshopId, userId]
    );

    if (workshopCheck.rowCount === 0) {
      return res.status(403).json({ message: 'Unauthorized to add service to this workshop' });
    }
    // قبل الإدخال
    const existing = await pool.query(
      `SELECT * FROM WorkshopEmergencyService WHERE workshop_id = $1 AND emergency_service_id = $2`,
      [workshopId, emergency_service_id]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'Service already added to this workshop' });
    }

    // Insert the emergency service into the database
    const result = await pool.query(
      `INSERT INTO WorkshopEmergencyService (workshop_id, emergency_service_id, price)
       VALUES ($1, $2, $3) RETURNING *`,
      [workshopId, emergency_service_id, price]
    );

    return res.status(201).json({ message: 'Emergency service added successfully', service: result.rows[0] });
  } catch (err) {
    console.error('Error adding emergency service:', err);
    return res.status(500).json({ error: 'Failed to add emergency service' });
  }
});

router.get('/emergency', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const result = await pool.query(
      `SELECT es.emergency_service_id, es.name, es.description, wes.price, es.category
       FROM EmergencyService es
       JOIN WorkshopEmergencyService wes ON es.emergency_service_id = wes.emergency_service_id
       JOIN Workshops w ON wes.workshop_id = w.workshop_id
       WHERE w.user_id = $1`,
      [userId]
    );

    return res.status(200).json({ emergencyServices: result.rows });
  } catch (err) {
    console.error('Error fetching emergency services:', err);
    return res.status(500).json({ error: 'Failed to fetch emergency services' });
  }
});


//delete emergency service from the workshop
router.delete('/emergency/:serviceId', authenticateJWT, async (req, res) => {
  const { serviceId } = req.params;
  const { workshopId } = req.body; // أو ممكن من query
  const userId = req.user.user_id;

  try {
    // تحقق أن الورشة تتبع لهذا المستخدم
    const check = await pool.query(
      `SELECT * FROM Workshop
       WHERE workshop_id = $1 AND owner_user_id = $2`,
      [workshopId, userId]
    );

    if (check.rowCount === 0) {
      return res.status(403).json({ message: 'Unauthorized to delete service from this workshop' });
    }

    // تحقق أن الخدمة موجودة ضمن هاي الورشة
    const exists = await pool.query(
      `SELECT * FROM WorkshopEmergencyService
       WHERE workshop_id = $1 AND emergency_service_id = $2`,
      [workshopId, serviceId]
    );

    if (exists.rowCount === 0) {
      return res.status(404).json({ message: 'Emergency service not found for this workshop' });
    }

    // احذف الخدمة
    await pool.query(
      `DELETE FROM WorkshopEmergencyService
       WHERE workshop_id = $1 AND emergency_service_id = $2`,
      [workshopId, serviceId]
    );

    return res.status(200).json({ message: 'Emergency service deleted successfully' });
  } catch (err) {
    console.error('Error deleting emergency service:', err);
    return res.status(500).json({ error: 'Failed to delete emergency service' });
  }
});
router.get('/search/:serviceId', authenticateJWT, async (req, res) => {
  const { serviceId } = req.params;
  const { city, street, lat, lon } = req.query;
  console.log('Searching emergency workshops for service:', serviceId);
  console.log('User query parameters:', { city, street, lat, lon });
  const userId = req.user.user_id; // ✅ رجعناه

  console.log('Searching emergency workshops for user:', userId);

  if (!city || !street || !lat || !lon) {
    return res.status(400).json({ error: 'Missing user address in request' });
  }

  try {
    const workshopsQuery = await pool.query(
      `
      SELECT w.workshop_id, w.workshop_name, w.rate, wes.price,
             a.city, a.street, a.latitude, a.longitude
      FROM WorkshopEmergencyService wes
      JOIN Workshops w ON wes.workshop_id = w.workshop_id
      JOIN Address a ON w.address_id = a.address_id
      WHERE wes.emergency_service_id = $1
      `,
      [serviceId]
    );

    const scoredResults = workshopsQuery.rows.map(w => {
      let score = 0;

      if (w.city?.toLowerCase() === city.toLowerCase()) score += 2;
      if (w.street?.toLowerCase() === street.toLowerCase()) score += 3;

      let distance = null;
      if (w.latitude && w.longitude) {
        distance = haversineDistance(
          parseFloat(lat),
          parseFloat(lon),
          w.latitude,
          w.longitude
        );
      }

      return { ...w, score, distance };
    });

    scoredResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      return 0;
    });
    console.log('Scored results:', scoredResults);
    return res.status(200).json({ workshops: scoredResults });
  } catch (err) {
    console.error('Error fetching emergency workshops for user', userId, ':', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

//to count 5 min expiry time
const getExpiryTime = (minutes = 5) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};



router.post('/emergencyBooking', authenticateJWT, async (req, res) => {
  const { vehicle_id, notes, workshopIds, requested_datetime, user_address, emergency_service_id, price } = req.body;
  const userId = req.user.user_id;
  console.log('Creating emergency booking:', { vehicle_id, notes, workshopIds, requested_datetime, userId, user_address, emergency_service_id, price });
  const utcDate = new Date(requested_datetime); // من الطلب '2025-07-04T14:51:04.565Z'

  // زد 3 ساعات (3 * 60 * 60 * 1000 مللي ثانية)
  const palestineDate = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000);
  console.log('Converted to Palestine Date:', palestineDate);

  // بعدين خزّن فلسطين ديت في قاعدة البيانات
  try {
    // أول شي تجيب customer_id من user_id
    const customerRes = await pool.query(
      `SELECT customer_id FROM Customers WHERE user_id = $1`,
      [userId]
    );

    if (customerRes.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found for this user' });
    }

    const customerId = customerRes.rows[0].customer_id;
    console.log('Customer ID:', customerId);

    // بعدين تعمل الحجز بـ customerId مش userId
    const bookingRes = await pool.query(
      `INSERT INTO EmergencyBooking (customer_id, vehicle_id, requested_datetime, notes , user_address, emergency_service_id , price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [customerId, vehicle_id, palestineDate, notes, user_address, emergency_service_id, price]
    );

    const booking = bookingRes.rows[0];
    const bookingId = booking.emergency_booking_id;

    // Insert 3 workshop options
    for (let i = 0; i < workshopIds.length; i++) {
      let expiresAt = null;
      let status = null;

      if (i === 0) {
        expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        status = 'Pending'; // فقط أول ورشة تكون مفعلة
      }

      await pool.query(
        `INSERT INTO EmergencyBookingRequest (emergency_booking_id, workshop_id, expires_at, status)
     VALUES ($1, $2, $3, $4)`,
        [bookingId, workshopIds[i], expiresAt, status]
      );
    }


    // Send notif to the 1st workshop
    const firstWorkshopId = workshopIds[0];
    const ownerRes = await pool.query(
      `SELECT user_id FROM Workshops WHERE workshop_id = $1`,
      [firstWorkshopId]
    );
    const receiverId = ownerRes.rows[0].user_id;

    await pool.query(
      `INSERT INTO Notification (
        sender_user_id, receiver_user_id, message, date,
        notification_type, target_group, is_read
      ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
      [userId, receiverId, '⚠️ Emergency request in your zone! Accept within 5 mins or it moves on ⏳', 'EmergencyRequest', 'Workshop']
    );

    // Let the customer know too
    await pool.query(
      `INSERT INTO Notification (
    sender_user_id, receiver_user_id, message, date,
    notification_type, target_group, is_read
  ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
      [1, userId, '⏳ Request sent! Wait 5 min for the workshop to respond.', 'EmergencyStatus', 'Customer']
    );


    res.status(201).json({ message: 'Emergency booking created 🔥', bookingId });
  } catch (err) {
    console.error('Emergency booking failed:', err);
    res.status(500).json({ error: 'Something went wrong 💀' });
  }
});

// ➕ اليوزر بده يمدد المهلة
router.post('/emergencyBooking/extend/:bookingId', authenticateJWT, async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.user_id;

  try {
    const latestReq = await pool.query(
      `SELECT * FROM EmergencyBookingRequest
       WHERE emergency_booking_id = $1 AND status = 'Pending'
       ORDER BY sent_at DESC LIMIT 1`,
      [bookingId]
    );

    if (latestReq.rowCount === 0) return res.status(404).json({ message: 'No pending request found' });

    const request = latestReq.rows[0];
    const newExpires = new Date(Date.now() + 5 * 60 * 1000);

    // Update expiry
    await pool.query(
      `UPDATE EmergencyBookingRequest SET expires_at = $1 WHERE emergency_request_id = $2`,
      [newExpires, request.emergency_request_id]
    );

    // Get workshop owner user ID
    const workshopOwner = await pool.query(
      `SELECT user_id FROM Workshops WHERE workshop_id = $1`,
      [request.workshop_id]
    );

    if (workshopOwner.rowCount > 0) {
      const receiverId = workshopOwner.rows[0].user_id;

      // Send that 🔥 notification
      await pool.query(
        `INSERT INTO Notification (
          sender_user_id, receiver_user_id, message, date,
          notification_type, target_group, is_read
        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
        [
          userId,
          receiverId,
          `⏰ Extra time granted! You got 5 more mins to accept this emergency. Don’t sleep on it 😴💥.`,
          'EmergencyExtension',
          'Workshop'
        ]
      );
    }

    res.status(200).json({ message: '⏳ Extended 5 more minutes & notified the workshop!' });
  } catch (err) {
    console.error('Extend time failed:', err);
    res.status(500).json({ error: 'Could not extend time 😵' });
  }
});

router.post('/emergencyBooking/skip/:bookingId', authenticateJWT, async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.user_id;

  try {
    // Step 1: Skip the current pending workshop
    const currentRes = await pool.query(
      `UPDATE EmergencyBookingRequest
       SET status = 'Skipped'
       WHERE emergency_booking_id = $1 AND status = 'Pending'
       RETURNING *`,
      [bookingId]
    );

    if (currentRes.rowCount === 0) {
      return res.status(404).json({ message: 'No pending request to skip' });
    }

    const skippedRequest = currentRes.rows[0];

    // 📨 Notify the old workshop: “You missed your chance”
    const oldWorkshopOwnerRes = await pool.query(
      `SELECT user_id FROM Workshops WHERE workshop_id = $1`,
      [skippedRequest.workshop_id]
    );
    const oldReceiverId = oldWorkshopOwnerRes.rows[0]?.user_id;

    if (oldReceiverId) {
      await pool.query(
        `INSERT INTO Notification (
          sender_user_id, receiver_user_id, message, date,
          notification_type, target_group, is_read
        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
        [
          userId,
          oldReceiverId,
          `❌ Time's up! This emergency request was transferred to another workshop. Gotta be quicker next time ⚡`,
          'EmergencySkipped',
          'Workshop'
        ]
      );
    }

    // Step 2: Activate the next one in line
    const nextRes = await pool.query(
      `SELECT * FROM EmergencyBookingRequest
   WHERE emergency_booking_id = $1 AND status IS NULL
   ORDER BY emergency_request_id ASC`,
      [bookingId]
    );



    if (nextRes.rowCount === 0) {
      return res.status(404).json({ message: 'No more workshops left 😬' });
    }

    const next = nextRes.rows[0];
    const newExpires = new Date(Date.now() + 5 * 60 * 1000);
    await pool.query(
      `UPDATE EmergencyBookingRequest
   SET expires_at = $1, status = 'Pending'
   WHERE emergency_request_id = $2`,
      [newExpires, next.emergency_request_id]
    );

    // Step 3: Notify the next workshop: “It’s your turn”
    const nextWorkshopOwner = await pool.query(
      `SELECT user_id FROM Workshops WHERE workshop_id = $1`,
      [next.workshop_id]
    );
    const nextReceiverId = nextWorkshopOwner.rows[0]?.user_id;

    if (nextReceiverId) {
      await pool.query(
        `INSERT INTO Notification (
          sender_user_id, receiver_user_id, message, date,
          notification_type, target_group, is_read
        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
        [
          userId,
          nextReceiverId,
          `⚡ New emergency request just landed in your court. You’ve got 5 mins to grab it!`,
          'EmergencyRequest',
          'Workshop'
        ]
      );
    }

    res.status(200).json({ message: '➡️ Moved to next workshop and notifications sent 🔔' });
  } catch (err) {
    console.error('Skip failed:', err);
    res.status(500).json({ error: 'Skip failed 🤕' });
  }
});


const activateNextWorkshop = async (bookingId, userId) => {
  const nextRes = await pool.query(
    `SELECT * FROM EmergencyBookingRequest
     WHERE emergency_booking_id = $1 AND status IS NULL
     ORDER BY emergency_request_id ASC`,
    [bookingId]
  );

  if (nextRes.rowCount === 0) {
    return { success: false, message: 'No more workshops left 😬' };
  }

  const next = nextRes.rows[0];
  const newExpires = new Date(Date.now() + 5 * 60 * 1000);

  await pool.query(
    `UPDATE EmergencyBookingRequest
     SET expires_at = $1, status = 'Pending'
     WHERE emergency_request_id = $2`,
    [newExpires, next.emergency_request_id]
  );

  const nextWorkshopOwner = await pool.query(
    `SELECT user_id FROM Workshops WHERE workshop_id = $1`,
    [next.workshop_id]
  );

  const nextReceiverId = nextWorkshopOwner.rows[0]?.user_id;

  if (nextReceiverId) {
    await pool.query(
      `INSERT INTO Notification (
        sender_user_id, receiver_user_id, message, date,
        notification_type, target_group, is_read
      ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, false)`,
      [
        userId,
        nextReceiverId,
        `⚡ New emergency request just landed in your court. You’ve got 5 mins to grab it!`,
        'EmergencyRequest',
        'Workshop'
      ]
    );
  }

  return { success: true, message: 'Next workshop activated!' };
};

// Get all emergency bookings for the user
router.get('/emergencyBookings', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  try {
    const bookings = await pool.query(
      `SELECT 
        eb.emergency_booking_id, 
        eb.requested_datetime, 
        eb.notes, 
        eb.status,
        eb.price,
        rv.make AS vehicle_make,
        rv.model AS vehicle_model,
        es.name AS service_name,
        eb.user_address,
        (SELECT COUNT(*) FROM EmergencyBookingRequest ebr WHERE ebr.emergency_booking_id = eb.emergency_booking_id) AS workshop_count
      FROM EmergencyBooking eb
      JOIN Customers c ON eb.customer_id = c.customer_id
      JOIN Vehicle v ON eb.vehicle_id = v.vehicle_id
      JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
      JOIN EmergencyService es ON eb.emergency_service_id = es.emergency_service_id
      WHERE c.user_id = $1
      ORDER BY eb.requested_datetime DESC;`,
      [userId]
    );

    return res.status(200).json({ bookings: bookings.rows });
  } catch (err) {
    console.error('Error fetching emergency bookings:', err);
    return res.status(500).json({ error: 'Failed to fetch emergency bookings' });
  }
});


// get all emergency bookings for the workshop
router.get('/workshop/emergencyBookings', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  console.log('Fetching emergency bookings for user:', userId);
  try {
    // Get workshop ID for the user
    const workshopRes = await pool.query(
      `SELECT workshop_id FROM Workshops WHERE user_id = $1`,
      [userId]
    );

    if (workshopRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workshop not found for this user' });
    }

    const workshopId = workshopRes.rows[0].workshop_id;
    console.log('Workshop ID:', workshopId);
    // Fetch emergency bookings for this workshop
    const bookings = await pool.query(
      `SELECT 
    eb.emergency_booking_id, 
    eb.requested_datetime, 
    eb.notes, 
    eb.status,
    eb.price,
    ebr.expires_at,
    ebr.status AS request_status,
    ebr.emergency_request_id,
    rv.make AS vehicle_make,
    rv.model AS vehicle_model,
    (u.first_name || ' ' || u.last_name) AS customer_name,
    u.phone_number AS customer_phone,
    es.name AS service_name,
    eb.user_address,
    (
      SELECT COUNT(*) 
      FROM EmergencyBookingRequest ebr 
      WHERE ebr.emergency_booking_id = eb.emergency_booking_id
    ) AS workshop_count
  FROM EmergencyBooking eb
  JOIN EmergencyBookingRequest ebr ON eb.emergency_booking_id = ebr.emergency_booking_id
  JOIN Vehicle v ON eb.vehicle_id = v.vehicle_id
  JOIN Customers c ON eb.customer_id = c.customer_id
  JOIN Users u ON c.user_id = u.user_id
  JOIN EmergencyService es ON eb.emergency_service_id = es.emergency_service_id
  JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
  WHERE ebr.workshop_id = $1
    AND (ebr.status = 'Pending' OR ebr.status = 'Accepted')
  ORDER BY eb.requested_datetime DESC;
`,
      [workshopId]
    );
    console.log('Emergency bookings for workshop:', bookings.rows);
    return res.status(200).json({ bookings: bookings.rows });
  } catch (err) {
    console.error('Error fetching emergency bookings for workshop:', err);
    return res.status(500).json({ error: 'Failed to fetch emergency bookings for workshop' });
  }
});

router.post('/emergencyBooking/respond/:bookingRequestId', authenticateJWT, async (req, res) => {
  const { bookingRequestId } = req.params;
  const { action } = req.body; // 'accept' أو 'reject'
  const userId = req.user.user_id;
  console.log('Responding to emergency booking request:', { bookingRequestId, action, userId });

  try {
    // أولاً: نتحقق من أن هذا الطلب يخص ورشة المستخدم
    const workshopRes = await pool.query(
      `SELECT w.workshop_id FROM Workshops w WHERE w.user_id = $1`,
      [userId]
    );

    if (workshopRes.rowCount === 0) {
      return res.status(403).json({ error: 'You are not associated with any workshop' });
    }

    const workshopId = workshopRes.rows[0].workshop_id;
    console.log('Workshop ID for user:', workshopId);
    // نجيب بيانات طلب الطوارئ هذا ونتأكد انه ينتمي للورشة
    const requestRes = await pool.query(
      `SELECT * FROM EmergencyBookingRequest WHERE emergency_request_id = $1 AND workshop_id = $2 AND status = 'Pending'`,
      [parseInt(bookingRequestId), workshopId]
    );
    console.log('Emergency booking request found:', requestRes.rows);

    if (requestRes.rowCount === 0) {
      return res.status(404).json({ error: 'No pending request found for your workshop' });
    }

    const request = requestRes.rows[0];

    if (action === 'accept') {
      // حدث حالة الطلب
      await pool.query(
        `UPDATE EmergencyBookingRequest SET status = 'Accepted', response_time = NOW() WHERE emergency_request_id = $1`,
        [bookingRequestId]
      );

      // حدث حالة الحجز للطوارئ نفسها، تأكيد الورشة
      await pool.query(
        `UPDATE EmergencyBooking SET status = 'Confirmed', confirmed_workshop_id = $1 WHERE emergency_booking_id = $2`,
        [workshopId, request.emergency_booking_id]
      );

      // إرسال إشعار للزبون
      const customerRes = await pool.query(
        `SELECT c.user_id FROM Customers c JOIN EmergencyBooking eb ON c.customer_id = eb.customer_id WHERE eb.emergency_booking_id = $1`,
        [request.emergency_booking_id]
      );

      if (customerRes.rowCount > 0) {
        const customerUserId = customerRes.rows[0].user_id;
        await pool.query(
          `INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type, target_group, is_read) VALUES
          ($1, $2, '✅ Your emergency request has been accepted by the workshop!', CURRENT_DATE, 'EmergencyStatus', 'Customer', false)`,
          [userId, customerUserId]
        );
      }

      // ممكن تلغي كل طلبات الورش الثانية للطلب نفسه لأنها اتقبلت
      await pool.query(
        `UPDATE EmergencyBookingRequest SET status = 'Rejected' WHERE emergency_booking_id = $1 AND emergency_request_id <> $2 AND status IS NULL`,
        [request.emergency_booking_id, bookingRequestId]
      );

      return res.json({ message: 'Booking accepted successfully' });

    } else if (action === 'reject') {
      // تحديث حالة الطلب المرفوض
      await pool.query(
        `UPDATE EmergencyBookingRequest
   SET status = 'Rejected', response_time = NOW()
   WHERE emergency_request_id = $1`,
        [bookingRequestId]
      );

      await activateNextWorkshop(request.emergency_booking_id, userId);

      if (!activateNextWorkshop.success) {
        return res.status(400).json({ error: activateNextWorkshop.message });
      }

      return res.json({ message: 'Booking rejected, moving to next workshop' });


    } else {
      return res.status(400).json({ error: 'Invalid action, must be accept or reject' });
    }

  } catch (error) {
    console.error('Error responding to emergency booking:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET all active emergency services
router.get('/emergency-services', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        emergency_service_id,
        name,
        description,
        category,
        is_active
      FROM EmergencyService
      WHERE is_active = TRUE
      ORDER BY emergency_service_id ASC
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching emergency services:', err);
    res.status(500).json({ error: 'Failed to fetch emergency services' });
  }
});

router.get('/emergency-bookings', async (req, res) => {
  const query = `
    SELECT 
      eb.emergency_booking_id,
      u.first_name || ' ' || u.last_name AS customer_name,
      rv.make || ' ' || rv.model || ' ' || rv.year AS vehicle_model,
      es.name AS emergency_service_name,
      es.category,
      eb.status,
      eb.requested_datetime,
      eb.created_at,
      eb.notes,
      eb.user_address,
      eb.price,
      
      w.workshop_name AS confirmed_workshop_name,

      STRING_AGG(DISTINCT wr.workshop_name, ', ') AS requested_workshops

    FROM EmergencyBooking eb
    JOIN Customers c ON eb.customer_id = c.customer_id
    JOIN Users u ON c.user_id = u.user_id
    JOIN Vehicle v ON eb.vehicle_id = v.vehicle_id
    JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
    JOIN EmergencyService es ON eb.emergency_service_id = es.emergency_service_id
    LEFT JOIN Workshops w ON eb.confirmed_workshop_id = w.workshop_id
    LEFT JOIN EmergencyBookingRequest ebr ON eb.emergency_booking_id = ebr.emergency_booking_id
    LEFT JOIN Workshops wr ON ebr.workshop_id = wr.workshop_id

    GROUP BY 
      eb.emergency_booking_id, u.first_name, u.last_name,
      rv.make, rv.model, rv.year,
      es.name, es.category, eb.status, eb.requested_datetime,
      eb.created_at, eb.notes, eb.user_address, eb.price, w.workshop_name

    ORDER BY eb.created_at DESC
  `;

  try {
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching emergency bookings:', err);
    res.status(500).json({ error: 'Server error while fetching emergency bookings' });
  }
});


// Export the router
module.exports = router;