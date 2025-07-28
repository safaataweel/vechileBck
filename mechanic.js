//sign up for a new account
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");
const { v4: uuidv4 } = require('uuid'); // optional for extra refresh token randomness

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Mechanic Sign Up Route
router.post('/signup', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email_address,
      password,
      workshop_name,
      phone_number,
      address
    } = req.body;

    // تأكد من وجود كل الحقول المطلوبة
    if (
      !first_name || !last_name || !email_address || !password ||
      !workshop_name || !phone_number || !address
    ) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // تأكد من أن العنوان يحتوي كل التفاصيل
    const { street, city, latitude, longitude } = address;

    if (!street || !city || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'Address fields are required' });
    }

    // تحقق من وجود مستخدم بنفس الإيميل
    const existingMechanic = await pool.query(
      'SELECT * FROM users WHERE email_address = $1',
      [email_address]
    );
    if (existingMechanic.rows.length > 0) {
      return res.status(400).json({ message: 'Mechanic already exists' });
    }

    // تشفير الباسورد
    const hashedPassword = await bcrypt.hash(password, 10);

    // إضافة المستخدم
    const userResult = await pool.query(
      `INSERT INTO users (first_name, last_name, email_address, password, role, phone_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING user_id`,
      [first_name, last_name, email_address, hashedPassword, 'Mechanic', phone_number]
    );
    const user_id = userResult.rows[0].user_id;

    // إضافة العنوان وربطه بالمستخدم
    const addressResult = await pool.query(
      `INSERT INTO address (street, city, latitude, longitude, user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING address_id`,
      [street, city, latitude, longitude, user_id]
    );
    const address_id = addressResult.rows[0].address_id;

    // إضافة الورشة وربطها بالمستخدم والعنوان
    const workshopResult = await pool.query(
      `INSERT INTO workshops (workshop_name, rate, capacity, address_id, user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING workshop_id`,
      [workshop_name, 0, 0, address_id, user_id]
    );
    const workshop_id = workshopResult.rows[0].workshop_id;



    res.status(201).json({ message: 'Mechanic registered successfully' });

  } catch (error) {
    console.error(error);
    if (error.code === '23502') {
      return res.status(400).json({ message: 'Missing required fields for address or user.' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /mechanic/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Check if user exists in Users table
    const userResult = await pool.query(
      'SELECT * FROM Users WHERE LOWER(TRIM(email_address)) = LOWER(TRIM($1))',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2. Check if the role is 'Mechanic'
    if (user.role !== 'Mechanic') {
      return res.status(403).json({ message: 'Access denied. Not a mechanic.' });
    }

    // 3. Validate the password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    // 4. Get mechanic-specific data
    const mechanicResult = await pool.query(
      'SELECT * FROM Workshops WHERE user_id = $1',
      [user.user_id]
    );

    if (mechanicResult.rows.length === 0) {
      return res.status(404).json({ message: 'Mechanic profile not found' });
    }

    const mechanic = mechanicResult.rows[0];

    // 5. Generate JWT (with user_id and role)
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        workshop_id: mechanic.workshop_id, // Adding mechanic_id in token
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    // 6. Return the token + other details
    res.status(200).json({
      token,
      user_id: user.user_id,
      workshop_id: mechanic.workshop_id,
      approval_status: mechanic.approval_status,
      workshop_name: mechanic.workshop_name,  // Optional: Return workshop name
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
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


// Route to get mechanic's approval status based on user_id
router.get('/api/mechanic/status', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;  // Extract user_id from the JWT token
  console.log('User ID from token:', userId); // Log the user ID for debugging

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    // Query the database to get the approval_status based on user_id
    const result = await pool.query('SELECT approval_status FROM Workshops WHERE user_id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Mechanic not found' });
    }

    const approvalStatus = result.rows[0].approval_status; // Extract approval status
    res.status(200).json({ approval_status: approvalStatus });

  } catch (error) {
    console.error('Error fetching mechanic status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/delete', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;  // Extract user_id from the JWT token
  console.log('User ID from token:', userId); // Log the user ID for debugging

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    // Delete the associated workshop first to prevent foreign key violation
    await pool.query('DELETE FROM Workshops WHERE user_id = $1', [userId]);

    // Delete the mechanic's user account
    await pool.query('DELETE FROM Users WHERE user_id = $1', [userId]);

    res.status(200).json({ message: 'Account and associated workshop deleted successfully.' });

  } catch (error) {
    console.error('Error deleting account and workshop:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

//get workshop details by id (no authentication)
router.get('/workshop/:id', async (req, res) => {
  const workshopId = req.params.id;

  try {
    const result = await pool.query('SELECT * FROM Workshops WHERE workshop_id = $1', [workshopId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found' });
    }

    res.status(200).json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching workshop details:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/workshop/:id/reviews', async (req, res) => {
  const workshopId = req.params.id;

  try {
    // Step 1: Get user_id from Workshops
    const workshopResult = await pool.query(
      'SELECT user_id FROM Workshops WHERE workshop_id = $1',
      [workshopId]
    );
    console.log('Workshop result:', workshopResult.rows); // Log the workshop result
    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found' });
    }

    const userId = workshopResult.rows[0].user_id;

    // Step 2: Get reviews where target='Workshop' and target_id=user_id
    const reviewsResult = await pool.query(
      "SELECT * FROM Review WHERE target = 'Workshop' AND target_id = $1",
      [userId]
    );
    console.log('Reviews result:', reviewsResult.rows); // Log the reviews result

    if (reviewsResult.rows.length === 0) {
      return res.status(404).json({ message: 'No reviews found for this workshop' });
    }

    res.status(200).json(reviewsResult.rows);

  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/home-me', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  console.log('User ID from token:', userId); // Log the user ID for debugging
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }


  try {
    const result = await pool.query(
      `
      SELECT 
        w.workshop_id,
        w.image,
        w.rate,
        u.first_name,
        u.last_name,
        a.street,
        a.city
      FROM Workshops w
      JOIN Users u ON w.user_id = u.user_id
      JOIN Address a ON w.address_id = a.address_id
      WHERE w.user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found' });
    }

    const data = result.rows[0];

    // Determine if the workshop is open
    const currentDay = new Date().getDay(); // 0 = Sunday
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    const hoursResult = await pool.query(
      `
      SELECT start_time, end_time
      FROM WorkshopWorkingHours
      WHERE workshop_id = $1 AND day_of_week = $2
      `,
      [data.workshop_id, currentDay]
    );

    let isOpen = false;
    if (hoursResult.rows.length > 0) {
      const { start_time, end_time } = hoursResult.rows[0];

      const toMinutes = (time) =>
        parseInt(time.slice(0, 2)) * 60 + parseInt(time.slice(3));
      const nowMinutes = toMinutes(currentTime);
      const startMinutes = toMinutes(start_time);
      const endMinutes = toMinutes(end_time);

      isOpen = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }

    return res.status(200).json({
      workshop_name: `${data.first_name}'s Workshop`,
      workshop_id: data.workshop_id,
      user_name: `${data.first_name} ${data.last_name}`,
      street: data.street,
      city: data.city,
      rate: data.rate,
      is_open: isOpen
    });
  } catch (error) {
    console.error('Error fetching workshop details:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET available working hours for a workshop by date
router.get('/workshop/:id/hours', async (req, res) => {
  const workshop_id = req.params.id;
  const date = req.query.date; // متوقع 'YYYY-MM-DD'

  if (!workshop_id || !date) {
    return res.status(400).json({ message: 'workshop_id and date are required' });
  }

  try {
    const result = await pool.query(`
      WITH working_hours AS (
        SELECT start_time, end_time
        FROM WorkshopWorkingHours
        WHERE workshop_id = $1
AND day_of_week = MOD(EXTRACT(DOW FROM $2::date)::int + 6, 7)
      ),
      booked_times AS (
        SELECT scheduled_time
        FROM Booking
        WHERE workshop_id = $1
          AND scheduled_date = $2
          AND booking_status IN ('pending', 'accepted', 'paid')
      )
      SELECT wh.start_time, wh.end_time
      FROM working_hours wh
      LEFT JOIN booked_times bt ON wh.start_time = bt.scheduled_time
      WHERE bt.scheduled_time IS NULL
      ORDER BY wh.start_time;
    `, [workshop_id, date]);

    if (result.rows.length === 0) {
      console.warn('No available hours for this date');
    }

    return res.status(200).json({
      workshop_id,
      date,
      available_hours: result.rows  // array of { start_time, end_time }
    });
  } catch (error) {
    console.error('Error fetching available hours:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/today/schedule', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id;
    console.log('User ID from token:', userId);

    const dateStr = req.query.date;
    if (!dateStr) {
      return res.status(400).json({ message: 'Date query parameter is required' });
    }

    // جلب الورشة المرتبطة بالمستخدم
    const result = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = result.rows[0].workshop_id;
    console.log('Workshop ID:', workshopId);

    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    // جلب ساعات العمل
    const workingHoursRes = await pool.query(`
      SELECT start_time, end_time 
      FROM WorkshopWorkingHours 
      WHERE workshop_id = $1 AND day_of_week = $2
    `, [workshopId, dayOfWeek]);

    if (workingHoursRes.rows.length === 0) {
      return res.status(404).json({ message: 'No working hours found for this workshop on the selected day' });
    }

    // جلب المواعيد المحجوزة
    const bookingsRes = await pool.query(`
      SELECT scheduled_time
      FROM Booking
      WHERE workshop_id = $1 AND scheduled_date = $2 AND booking_status IN ('pending', 'accepted', 'paid')
    `, [workshopId, dateStr]);

    const bookedTimes = bookingsRes.rows.map(b => b.scheduled_time);

    // جلب الاستثناءات
    const exceptionsRes = await pool.query(`
      SELECT time_start, time_end, status
      FROM WorkshopAvailabilityExceptions
      WHERE workshop_id = $1 AND date = $2
    `, [workshopId, dateStr]);

    const timeToMinutes = (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const workingHours = workingHoursRes.rows[0];
    const startMinutes = timeToMinutes(workingHours.start_time);
    const endMinutes = timeToMinutes(workingHours.end_time);
    const slotDurationMinutes = 30;

    let schedule = [];

    for (let t = startMinutes; t + slotDurationMinutes <= endMinutes; t += slotDurationMinutes) {
      const hours = String(Math.floor(t / 60)).padStart(2, '0');
      const minutes = String(t % 60).padStart(2, '0');
      const slotTime = `${hours}:${minutes}:00`;
      const displayTime = `${hours}:${minutes}`;

      const isBooked = bookedTimes.some(booked => booked === slotTime);

      const isInException = exceptionsRes.rows.some(ex => {
        const exStart = timeToMinutes(ex.time_start);
        const exEnd = timeToMinutes(ex.time_end);
        return (t >= exStart && t < exEnd) && (ex.status === 'closed' || ex.status === 'unavailable');
      });

      let status = 'available';
      if (isBooked || isInException) {
        status = 'busy';
      }

      schedule.push({
        time: displayTime,
        status: status
      });
    }

    return res.json({ schedule });

  } catch (err) {
    console.error('Error fetching available hours:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/availability-exception', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { date, time_start, time_end, status, workshop_id } = req.body;

  if (!date || !time_start || !time_end || !status || !workshop_id) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (!['closed', 'unavailable'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    // تحقق من الورشة (تأكد أن الورشة تابعة لهذا المستخدم أو له صلاحية)
    const workshopCheck = await pool.query('SELECT workshop_id FROM Workshops WHERE workshop_id = $1 AND user_id = $2', [workshop_id, userId]);
    if (workshopCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Unauthorized or workshop not found' });
    }

    // أضف الاستثناء
    await pool.query(
      `INSERT INTO WorkshopAvailabilityExceptions (workshop_id, date, time_start, time_end, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [workshop_id, date, time_start, time_end, status]
    );

    return res.status(201).json({ message: 'Availability exception added successfully' });
  } catch (err) {
    console.error('Error adding availability exception:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});



const generateWorkingHourSummary = (hours) => {
  // hours = array of rows from WorkshopWorkingHours for 1 workshop
  const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Group hours by time slot
  const timeGroups = {};
  for (const { day_of_week, start_time, end_time } of hours) {
    const key = `${start_time}-${end_time}`;
    if (!timeGroups[key]) timeGroups[key] = [];
    timeGroups[key].push(day_of_week);
  }

  const summaryParts = [];
  for (const [timeRange, days] of Object.entries(timeGroups)) {
    // Sort days
    const sorted = days.sort((a, b) => a - b);
    const dayStr =
      sorted.length === 1
        ? dayMap[sorted[0]]
        : `${dayMap[sorted[0]]}–${dayMap[sorted[sorted.length - 1]]}`;

    // Format time
    const [start, end] = timeRange.split("-");
    const formatted = `${dayStr}: ${formatTime(start)} – ${formatTime(end)}`;
    summaryParts.push(formatted);
  }

  return summaryParts.join(', ');
};

const formatTime = (time24) => {
  const [hour, minute] = time24.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${minute.toString().padStart(2, "0")} ${suffix}`;
};
router.post('/workshop/working-hours', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { hours } = req.body; // array of objects: { day_of_week, start_time, end_time }

  const client = await pool.connect();

  try {
    // 1. Get the user's workshop_id
    const workshopResult = await client.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // 2. Delete old hours (optional if you want to replace)
    await client.query('DELETE FROM WorkshopWorkingHours WHERE workshop_id = $1', [workshopId]);

    // 3. Insert new hours
    for (const { day_of_week, start_time, end_time } of hours) {
      await client.query(
        `INSERT INTO WorkshopWorkingHours (workshop_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [workshopId, day_of_week, start_time, end_time]
      );
    }

    // 4. Build summary
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const timeGroups = {};

    for (const { day_of_week, start_time, end_time } of hours) {
      const key = `${start_time}-${end_time}`;
      if (!timeGroups[key]) timeGroups[key] = [];
      timeGroups[key].push(day_of_week);
    }

    const formatTime = (time24) => {
      const [hour, minute] = time24.split(":").map(Number);
      const suffix = hour >= 12 ? "PM" : "AM";
      const h12 = ((hour + 11) % 12) + 1;
      return `${h12}:${minute.padStart(2, '0')} ${suffix}`;
    };

    const summaryParts = Object.entries(timeGroups).map(([timeRange, days]) => {
      days.sort((a, b) => a - b);
      const dayStr =
        days.length === 1
          ? dayMap[days[0]]
          : `${dayMap[days[0]]}–${dayMap[days[days.length - 1]]}`;
      const [start, end] = timeRange.split("-");
      return `${dayStr}: ${formatTime(start)} – ${formatTime(end)}`;
    });

    const summary = summaryParts.join(', ');

    // 5. Update workshop table
    await client.query(
      'UPDATE Workshops SET working_day_hours = $1 WHERE workshop_id = $2',
      [summary, workshopId]
    );

    res.status(200).json({
      message: '✅ Working hours saved and summary updated',
      summary,
    });
  } catch (error) {
    console.error('❌ Error saving working hours:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/mechanic/working-hours', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    const result = await pool.query(
      `SELECT day_of_week, start_time, end_time
       FROM WorkshopWorkingHours
       WHERE workshop_id = $1
       ORDER BY day_of_week`,
      [workshopId]
    );

    res.json({
      message: '✅ Working hours fetched',
      hours: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching working hours:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/mechanic/working-hours', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { hours } = req.body; // same: [{ day_of_week, start_time, end_time }, ...]

  const client = await pool.connect();

  try {
    const workshopResult = await client.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // Delete old hours
    await client.query('DELETE FROM WorkshopWorkingHours WHERE workshop_id = $1', [workshopId]);

    // Insert new hours
    for (const { day_of_week, start_time, end_time } of hours) {
      await client.query(
        `INSERT INTO WorkshopWorkingHours (workshop_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [workshopId, day_of_week, start_time, end_time]
      );
    }

    // Build summary string again
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const timeGroups = {};

    for (const { day_of_week, start_time, end_time } of hours) {
      const key = `${start_time}-${end_time}`;
      if (!timeGroups[key]) timeGroups[key] = [];
      timeGroups[key].push(day_of_week);
    }

    const formatTime = (time24) => {
      const [hour, minute] = time24.split(":").map(Number);
      const suffix = hour >= 12 ? "PM" : "AM";
      const h12 = ((hour + 11) % 12) + 1;
      return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
    };


    const summaryParts = Object.entries(timeGroups).map(([timeRange, days]) => {
      days.sort((a, b) => a - b);
      const dayStr =
        days.length === 1
          ? dayMap[days[0]]
          : `${dayMap[days[0]]}–${dayMap[days[days.length - 1]]}`;
      const [start, end] = timeRange.split("-");
      return `${dayStr}: ${formatTime(start)} – ${formatTime(end)}`;
    });

    const summary = summaryParts.join(', ');

    await client.query(
      'UPDATE Workshops SET working_day_hours = $1 WHERE workshop_id = $2',
      [summary, workshopId]
    );

    res.status(200).json({
      message: '✅ Working hours updated',
      summary
    });
  } catch (error) {
    console.error('❌ Error updating working hours:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/payments', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    // Get workshop_id for this mechanic
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    const query = `
      SELECT 
        p.payment_id,
        p.income_value,
        p.percent_to_admin,
        p.percent_to_workshop,
        p.date AS payment_date,
        p.type AS payment_type,
        p.payment_status,

        b.booking_id,
        b.scheduled_date,
        b.scheduled_time,
        b.status_name AS booking_status,
        b.amount_paid,
        b.refund_issued,
        b.refund_amount,

        u.first_name,
        u.last_name,

        ARRAY_AGG(s.service_name) AS services

      FROM Payment p
      JOIN Booking b ON p.booking_id = b.booking_id
      JOIN Users u ON b.user_id = u.user_id
      JOIN BookingService bs ON b.booking_id = bs.booking_id
      JOIN Service s ON bs.service_id = s.service_id
      WHERE b.workshop_id = $1
      GROUP BY 
        p.payment_id, p.income_value, p.percent_to_admin, p.percent_to_workshop,
        p.date, p.type, p.payment_status,
        b.booking_id, b.scheduled_date, b.scheduled_time, b.status_name, b.amount_paid, b.refund_issued, b.refund_amount,
        u.first_name, u.last_name
      ORDER BY p.date DESC
      LIMIT 20;
    `;

    const result = await pool.query(query, [workshopId]);

    const formatted = result.rows.map(tx => ({
      paymentId: tx.payment_id,
      description: `${tx.payment_type} for ${tx.services.join(', ')}`,
      date: tx.payment_date,
      amount: `$${tx.income_value}`,
      customer: `${tx.first_name} ${tx.last_name}`,
      refund: tx.refund_issued ? `$${tx.refund_amount}` : null,
      bookingId: tx.booking_id,
      bookingStatus: tx.booking_status,
      services: tx.services,
      paymentStatus: tx.payment_status
    }));

    res.json({
      message: '✅ Workshop transactions fetched successfully',
      transactions: formatted
    });

  } catch (error) {
    console.error('❌ Error fetching workshop payments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/mechanic/dashboard', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(':').slice(0, 2).join(':');

    const [
      servicesTodayResult,
      requestsTodayResult,
      monthlyRevenueResult,
      avgRatingResult,
      bestServiceResult,
      pendingResult,
      completedResult,
      workingHoursResult,
      statusCountsResult
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM Booking 
         WHERE workshop_id = $1 AND scheduled_date = CURRENT_DATE`,
        [workshopId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM Booking 
         WHERE workshop_id = $1 AND booking_status = 'pending'`,
        [workshopId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(income_value), 0) AS total 
         FROM Payment 
         WHERE booking_id IN (
           SELECT booking_id FROM Booking 
           WHERE workshop_id = $1 AND EXTRACT(MONTH FROM booking_date) = EXTRACT(MONTH FROM CURRENT_DATE)
         )`,
        [workshopId]
      ),
      pool.query(
        `SELECT CAST(AVG(rating) AS NUMERIC(10,2)) AS avg_rating 
         FROM Review 
         WHERE workshop_id = $1`,
        [workshopId]
      ),
      pool.query(
        `SELECT s.service_name, COUNT(*) as count
         FROM BookingService bs
         JOIN Service s ON bs.service_id = s.service_id
         JOIN Booking b ON bs.booking_id = b.booking_id
         WHERE b.workshop_id = $1
         GROUP BY s.service_name
         ORDER BY count DESC
         LIMIT 1`,
        [workshopId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM Booking 
         WHERE workshop_id = $1 AND booking_status = 'pending'`,
        [workshopId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM Booking 
         WHERE workshop_id = $1 AND booking_status ILIKE '%complete paid%' AND 
               EXTRACT(MONTH FROM completion_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
        [workshopId]
      ),
      pool.query(
        `SELECT start_time, end_time FROM WorkshopWorkingHours 
         WHERE workshop_id = $1 AND day_of_week = EXTRACT(DOW FROM CURRENT_DATE)`,
        [workshopId]
      ),
      // 👇 إجلب عدد كل حالة من status_name
      pool.query(
        `SELECT status_name, COUNT(*) as count 
         FROM Booking 
         WHERE workshop_id = $1 
         GROUP BY status_name`,
        [workshopId]
      )

    ]);

    // Check if workshop is open
    let isOpen = false;
    const workingHours = workingHoursResult.rows;
    for (const { start_time, end_time } of workingHours) {
      if (currentTime >= start_time && currentTime <= end_time) {
        isOpen = true;
        break;
      }
    }

    // Process status counts
    const statusCounts = {
      not_started: 0,
      in_progress: 0,
      complete: 0
    };
    for (const row of statusCountsResult.rows) {
      const status = row.status_name.toLowerCase();
      if (status === 'not started') statusCounts.not_started = parseInt(row.count);
      if (status === 'in progress') statusCounts.in_progress = parseInt(row.count);
      if (status === 'complete') statusCounts.complete = parseInt(row.count);
    }

    res.json({
      servicesToday: parseInt(servicesTodayResult.rows[0].count),
      requestsToday: parseInt(requestsTodayResult.rows[0].count),
      monthlyRevenue: parseFloat(monthlyRevenueResult.rows[0].total),
      averageRating: parseFloat(avgRatingResult.rows[0].avg_rating) || 0,
      bestService: bestServiceResult.rows[0]?.service_name || 'N/A',
      openStatus: isOpen,
      pendingRequests: parseInt(pendingResult.rows[0].count),
      completedServices: parseInt(completedResult.rows[0].count),
      statusBreakdown: statusCounts // ⬅️ الحالة حسب status_name
    });
  } catch (error) {
    console.error('❌ Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
