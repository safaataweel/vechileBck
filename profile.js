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

const profileCache = require('./cache');
router.put('/edit', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const {
    first_name,
    last_name,
    email_address,
    phone_number,
    profile_picture,
    role,
    workshop_name,
    address
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // تحديث بيانات المستخدمين الأساسية
    await client.query(`
      UPDATE Users
      SET first_name = $1,
          last_name = $2,
          email_address = $3,
          phone_number = $4,
          profile_picture = $5
      WHERE user_id = $6
    `, [first_name, last_name, email_address, phone_number, profile_picture, userId]);

    // تحديث العنوان لو موجود، لأي يوزر
if (address) {
  const { street, city, latitude, longitude } = address;

  // نحاول نحدث العنوان، وإذا ما في عنوان نعمل إدخال جديد
  const addressResult = await client.query(`
    UPDATE Address
    SET street = $1,
        city = $2,
        latitude = $3,
        longitude = $4
    WHERE user_id = $5
    RETURNING address_id
  `, [street, city, latitude, longitude, userId]);

  let addressId;

  if (addressResult.rowCount > 0) {
    addressId = addressResult.rows[0].address_id;
  } else {
    const insertResult = await client.query(`
      INSERT INTO Address (street, city, latitude, longitude, user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING address_id
    `, [street, city, latitude, longitude, userId]);

    addressId = insertResult.rows[0].address_id;
  }

      // لو اليوزر ميكانيكي وعنده اسم ورشة يحدث اسم الورشة
       // لو اليوزر ميكانيكي وعنده اسم ورشة يحدث اسم الورشة
  if (role === 'Mechanic' && workshop_name) {
    await client.query(`
      UPDATE Workshops
      SET workshop_name = $1
      WHERE address_id = $2
    `, [workshop_name, addressId]);
  }
}

 await client.query('COMMIT');

console.log(`Deleting cache for user ${userId}`);
profileCache.del(userId);

res.status(200).json({ message: 'Profile updated successfully 🙌' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Edit profile error:', err.message);
    res.status(500).json({ message: 'Something went wrong 😔' });
  } finally {
    client.release();
  }
});


  // router.put('/mechanic/working-hours', authenticateJWT, async (req, res) => {
  //   const userId = req.user.user_id;
  //   const { working_day_hours } = req.body;
  
  //   if (!working_day_hours) {
  //     return res.status(400).json({ message: 'working_day_hours is required 🙃' });
  //   }
  
  //   const client = await pool.connect();
  //   try {
  //     // 🔍 أول شي نجيب address_id تبع هذا الميكانيكي
  //     const addressResult = await client.query(`
  //       SELECT address_id FROM Address WHERE user_id = $1
  //     `, [userId]);
  
  //     if (addressResult.rows.length === 0) {
  //       return res.status(404).json({ message: 'Address not found for the user 😕' });
  //     }
  
  //     const addressId = addressResult.rows[0].address_id;
  
  //     // ✏️ نحدث ساعات العمل
  //     const updateResult = await client.query(`
  //       UPDATE Workshops
  //       SET working_day_hours = $1
  //       WHERE address_id = $2
  //     `, [working_day_hours, addressId]);
  
  //     res.status(200).json({ message: 'Working hours updated successfully ⏰✅' });
  //   } catch (err) {
  //     console.error('❌ Error updating working hours:', err.message);
  //     res.status(500).json({ message: 'Failed to update working hours 😩' });
  //   } finally {
  //     client.release();
  //   }
  // });
  
 router.put('/mechanic/working-hours', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const workingHours = req.body; // array of {day_of_week, start_time, end_time}

  if (!Array.isArray(workingHours) || workingHours.length === 0) {
    return res.status(400).json({ message: 'Working hours array is required ⏰😅' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 📍 نجيب workshop_id للمستخدم
    const workshopResult = await client.query(`
      SELECT workshop_id FROM Workshops WHERE user_id = $1
    `, [userId]);

    if (workshopResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found for this user 🤷‍♀️' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // 🧹 نحذف الساعات القديمة أول
    await client.query(`DELETE FROM WorkshopWorkingHours WHERE workshop_id = $1`, [workshopId]);

    // 🆕 نضيف الساعات الجديدة
    for (const hour of workingHours) {
      await client.query(`
        INSERT INTO WorkshopWorkingHours (workshop_id, day_of_week, start_time, end_time)
        VALUES ($1, $2, $3, $4)
      `, [workshopId, hour.day_of_week, hour.start_time, hour.end_time]);
    }

    // 📝 نحول الساعات لـ string للعرض
    const workingHoursString = summarizeWorkingHours(workingHours);

    await client.query(`
      UPDATE Workshops SET working_day_hours = $1 WHERE workshop_id = $2
    `, [workingHoursString, workshopId]);

    await client.query('COMMIT');
    res.status(200).json({ message: 'Working hours updated successfully ✅🕒' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating working hours:', err);
    res.status(500).json({ message: 'Failed to update working hours 😵' });
  } finally {
    client.release();
  }
});

// ➕ Helper functions to format time and summarize days
function summarizeWorkingHours(hoursArr) {
  if (hoursArr.length === 0) return 'Closed';

  const sorted = [...hoursArr].sort((a, b) => a.day_of_week - b.day_of_week);
  const firstDay = sorted[0].day_of_week;
  const lastDay = sorted[sorted.length - 1].day_of_week;

  const startTime = formatTime(sorted[0].start_time);
  const endTime = formatTime(sorted[0].end_time);

  const dayAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${dayAbbr[firstDay]}-${dayAbbr[lastDay]}: ${startTime} - ${endTime}`;
}

function formatTime(timeStr) {
  const [hour, minute] = timeStr.split(':');
  const h = parseInt(hour);
  const m = minute.padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const formattedHour = h % 12 === 0 ? 12 : h % 12;
  return `${formattedHour}:${m} ${ampm}`;
}


  module.exports = router;