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
  
      // 🔄 Update Users
      await client.query(`
        UPDATE Users
        SET first_name = $1,
            last_name = $2,
            email_address = $3,
            phone_number = $4,
            profile_picture = $5
        WHERE user_id = $6
      `, [first_name, last_name, email_address, phone_number, profile_picture, userId]);
  
      // 🧰 Mechanic-specific updates
      if (role === 'Mechanic' && address) {
        const { street, city, latitude, longitude } = address;
  
        const addressResult = await client.query(`
          UPDATE Address
          SET street = $1,
              city = $2,
              latitude = $3,
              longitude = $4
          WHERE user_id = $5
          RETURNING address_id
        `, [street, city, latitude, longitude, userId]);
  
        if (addressResult.rows.length === 0) {
          throw new Error('Address not found for the user.');
        }
  
        const addressId = addressResult.rows[0]?.address_id;
  
        if (workshop_name) {
          await client.query(`
            UPDATE Workshops
            SET workshop_name = $1
            WHERE address_id = $2
          `, [workshop_name, addressId]);
        }
      }
  
      await client.query('COMMIT');
      res.status(200).json({ message: 'Profile updated successfully 🙌' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Edit profile error:', err.message);
      res.status(500).json({ message: 'Something went wrong 😔' });
    } finally {
      client.release();
    }
  });

  router.put('/mechanic/working-hours', authenticateJWT, async (req, res) => {
    const userId = req.user.user_id;
    const { working_day_hours } = req.body;
  
    if (!working_day_hours) {
      return res.status(400).json({ message: 'working_day_hours is required 🙃' });
    }
  
    const client = await pool.connect();
    try {
      // 🔍 أول شي نجيب address_id تبع هذا الميكانيكي
      const addressResult = await client.query(`
        SELECT address_id FROM Address WHERE user_id = $1
      `, [userId]);
  
      if (addressResult.rows.length === 0) {
        return res.status(404).json({ message: 'Address not found for the user 😕' });
      }
  
      const addressId = addressResult.rows[0].address_id;
  
      // ✏️ نحدث ساعات العمل
      const updateResult = await client.query(`
        UPDATE Workshops
        SET working_day_hours = $1
        WHERE address_id = $2
      `, [working_day_hours, addressId]);
  
      res.status(200).json({ message: 'Working hours updated successfully ⏰✅' });
    } catch (err) {
      console.error('❌ Error updating working hours:', err.message);
      res.status(500).json({ message: 'Failed to update working hours 😩' });
    } finally {
      client.release();
    }
  });
  
  
  
  module.exports = router;