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



router.post('/login', async (req, res) => {
    const { email_address, password } = req.body;
  
    try {
      const userResult = await pool.query(
        `SELECT * FROM users WHERE email_address = $1`,
        [email_address]
      );
  
      if (userResult.rows.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
  
      const user = userResult.rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
  
      // Generate tokens
      const accessToken = jwt.sign(
        { user_id: user.user_id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
  
      const refreshToken = jwt.sign(
        { user_id: user.user_id },
        process.env.REFRESH_SECRET,
        { expiresIn: '7d' }
      );
  
      // Store refresh token in DB
      await pool.query(
        `UPDATE users SET refresh_token = $1 WHERE user_id = $2`,
        [refreshToken, user.user_id]
      );
  
      // ✅ هون بتحطّيهم
      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: user.user_id,
        role: user.role, // لو ما عندك role، احذفي هالسطر
        message: "Login successful"
      });
  
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Internal server error' });
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
  

module.exports = router;
