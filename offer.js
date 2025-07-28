const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const jwt = require('jsonwebtoken');

// PostgreSQL Pool setup
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
router.get('/offers/customers', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const offersQuery = await pool.query(`
      SELECT o.*, 
             ot.description, 
             ot.duration, 
             ot.discount_percentage, 
             sc.category_name AS service_category_name
      FROM Offer o
      JOIN OfferType ot ON o.offer_type_id = ot.offer_type_id
      LEFT JOIN ServiceCategories sc ON ot.service_category_id = sc.category_id
      WHERE 
        (o.target_type = 'all')
        OR 
        (o.target_type = 'customer' AND o.target_id = $1)
    `, [userId]);

    if (offersQuery.rows.length === 0) {
      return res.status(404).json({ message: 'No offers found for this customer.' });
    }

    res.status(200).json({
      message: '✅ Offers for the customer (including general offers) retrieved successfully.',
      offers: offersQuery.rows,
    });

  } catch (error) {
    console.error('❌ Error fetching customer offers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});




router.get('/offers/workshops', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user.user_id; // assuming JWT payload has user_id
    console.log('User ID from token:', userId); // debug log

   const offersQuery = await pool.query(`
  SELECT o.*, 
         ot.description, 
         ot.duration, 
         ot.discount_percentage, 
         sc.category_name AS service_category_name
  FROM Offer o
  JOIN OfferType ot ON o.offer_type_id = ot.offer_type_id
  LEFT JOIN ServiceCategories sc ON ot.service_category_id = sc.category_id
  JOIN Users c ON o.target_id = c.user_id
  WHERE o.target_id = $1
`, [userId]);

    if (offersQuery.rows.length === 0) {
      return res.status(404).json({ message: 'No offers found for this workshop.' });
    }

    res.status(200).json({
      message: 'Offers for the current workshop retrieved successfully.',
      offers: offersQuery.rows,
    });

  } catch (error) {
    console.error('Error fetching workshop offers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// POST /offers - إضافة عرض جديد
router.post('/offers', async (req, res) => {
  const {
    title,
    description,
    service_category_id,
    duration,
    discount_percentage,
    target_type,
    target_id,
    start_date,
    end_date,
    total_price,
    status = 'active',
  } = req.body;

  // Validation بسيطة
  if (

    !description ||
    !target_type ||
    !start_date ||
    !end_date ||
    !total_price
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const query = `
      INSERT INTO Offer 
      (title,description, service_category_id, duration, discount_percentage, target_type, target_id, start_date, end_date, total_price, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,$11)
      RETURNING *;
    `;

    const values = [
      title,
      description,
      service_category_id || null,
      duration || null,
      discount_percentage || null,
      target_type,
      target_id || null,
      start_date,
      end_date,
      total_price,
      status,
    ];

    const { rows } = await pool.query(query, values);

    res.status(201).json({
      message: 'Offer created successfully',
      offer: rows[0],
    });
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



module.exports = router;
