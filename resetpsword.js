const crypto = require('crypto');
const nodemailer = require('nodemailer');
const express = require('express');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();  // For loading environment variables


const router = express.Router();

// PostgreSQL setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,  // Make sure DATABASE_URL is set in .env
});

router.post('/forgot-password', async (req, res) => {
  const { email_address } = req.body;

  try {
    // Check if the user exists in the database
    const userRes = await pool.query('SELECT * FROM Users WHERE email_address = $1', [email_address]);

    // Respond the same way whether the user exists or not for security reasons
    if (userRes.rows.length === 0) {
      return res.status(200).json({ message: 'If an account exists, you’ll receive an email' });
    }

    const user = userRes.rows[0];
    const token = crypto.randomBytes(32).toString('hex');  // Generate a random token
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);  // Token expires in 15 minutes

    // Store token and expiration in the database (PasswordResetTokens table)
    await pool.query(
      `INSERT INTO PasswordResetTokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.user_id, token, expiresAt]
    );

    // Email content for reset token
    const resetTokenText = `Use this code to reset your password: ${token}`;

    // Setup email transporter (using Gmail as an example)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USERNAME,  // Your email address
        pass: process.env.EMAIL_PASSWORD,  // Your email password or app-specific password
      },
    });

    // Send the reset email
    await transporter.sendMail({
        from: '"MyApp Support" <no-reply@myapp.com>',
        to: email_address,
        subject: 'Reset your password',
        text: resetTokenText,
        html: `<p>${resetTokenText}</p>`,
      });

    // Respond to the client (success message without revealing user existence for security)
    res.status(200).json({ message: 'If an account exists, you’ll receive an email' , token});
    console.log("token", token);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
    const { token, new_password } = req.body;
  
    console.log('Received token:', token);
    console.log('Received new_password:', new_password);
  
    try {
      if (!token || !new_password) {
        return res.status(400).json({ message: 'Token and new password are required.' });
      }
  
      const tokenRes = await pool.query(
        `SELECT * FROM PasswordResetTokens WHERE token = $1 AND used = false AND expires_at > NOW()`,
        [token]
      );
  
      if (tokenRes.rows.length === 0) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }
  
      const { user_id } = tokenRes.rows[0];
  
      const hashedPassword = await bcrypt.hash(new_password, 10);
  
      await pool.query(
        `UPDATE Users SET password = $1 WHERE user_id = $2`,
        [hashedPassword, user_id]
      );
  
      await pool.query(
        `UPDATE PasswordResetTokens SET used = true WHERE token = $1`,
        [token]
      );
  
      res.status(200).json({ message: 'Password reset successful' });
    } catch (err) {
      console.error('Reset password error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
module.exports = router;
