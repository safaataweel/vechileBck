//sign up for a new account
const express = require('express');
const router = express.Router();


require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");


// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
//sign up for customer 
router.post('/signup', async (req, res) => {
    const { first_name, last_name, email_address, password, role } = req.body;

    // Check if the role is valid
    if (!['Customer', 'Admin', 'Mechanic'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role provided' });
    }

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into Users table with the role field
        const userResult = await pool.query(
            `INSERT INTO users (first_name, last_name, email_address, password, role) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [first_name, last_name, email_address, hashedPassword, role] // Include role in query
        );

        const newUser = userResult.rows[0];

        // Insert into Customers table using the new user's ID
        await pool.query(
            `INSERT INTO customers (user_id) VALUES ($1)`,
            [newUser.user_id]
        );

        // Send response with the new user
        res.status(201).json({ message: 'User and customer created successfully', user: newUser });

    } catch (error) {
        console.error('Error creating user and customer:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//login for customer
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid'); // optional for extra refresh token randomness

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
  

module.exports = router;