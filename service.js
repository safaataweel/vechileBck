const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const jwt = require('jsonwebtoken'); // تأكد من استيراد jwt

// PostgreSQL Pool setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
router.get('/service-subcategories', async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT s.subcategory_id, s.subcategory_name, s.price, c.category_name
            FROM SubCategories s
            JOIN ServiceCategories c ON s.category_id = c.category_id
        `);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching service subcategories:', error);
    res.status(500).json({ error: 'Server error while retrieving service subcategories.' });
  }
});
router.get('/services/frequent', async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT subcategory_id AS id, subcategory_name AS name, price
            FROM SubCategories
            ORDER BY RANDOM()
            LIMIT 5
        `);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching frequent services:', error);
    res.status(500).json({ error: 'Server error while retrieving frequent services.' });
  }
});


//route to add a new service for the workshop
router.post('/services', async (req, res) => {
  const {
    service_name,
    service_description,
    category_id,
    subcategory_id,
    price,
    workshop_id,
    estimated_duration,
    is_mobile = false,      // ⚡ القيمة الافتراضية false لو ما جت
    mobile_fee = 0          // ⚡ القيمة الافتراضية 0 لو ما جت
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO Service 
          (service_name, service_description, category_id, subcategory_id, price, workshop_id, estimated_duration, is_mobile, mobile_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
      [service_name, service_description, category_id, subcategory_id, price, workshop_id, estimated_duration, is_mobile, mobile_fee]
    );

    res.status(201).json({
      message: '✅ Service created successfully',
      service: result.rows[0]
    });
  } catch (error) {
    console.error('🚨 Error inserting service:', error);
    res.status(500).json({ error: 'Something went wrong while adding the service.' });
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

router.get('/my-workshop', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  console.log("User ID received:", userId);  // Log the userId received from token

  try {
    const result = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (result.rowCount === 0) {
      console.log("No workshop found for this user");  // Log if no workshop found
      return res.status(404).json({ message: '🚫 No workshop found for this user' });
    }

    console.log("Workshop ID found:", result.rows[0].workshop_id);  // Log the workshop_id found
    res.json({ workshopId: result.rows[0].workshop_id });
    console.log("Workshop ID sent in response:", result.rows[0].workshop_id);  // Log the workshop_id sent in response
  } catch (error) {
    console.error('❌ Error getting workshop_id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/services/:id', authenticateJWT, async (req, res) => {
  const serviceId = req.params.id;
  const userId = req.user.user_id;

  try {
    // Get the workshop_id for the logged-in user
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(403).json({ message: '🚫 No workshop found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // Delete the service ONLY IF it belongs to this workshop
    const deleteResult = await pool.query(
      'DELETE FROM Service WHERE service_id = $1 AND workshop_id = $2 RETURNING *',
      [serviceId, workshopId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: '❌ Service not found or unauthorized' });
    }

    res.json({
      message: '✅ Service deleted successfully',
      deleted: deleteResult.rows[0]
    });
  } catch (error) {
    console.error('🚨 Error deleting service:', error);
    res.status(500).json({ error: 'Something went wrong while deleting the service.' });
  }
});

router.get('/workshops/:id/services', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         s.service_id, 
         s.service_name, 
         s.service_description, 
         s.price, 
         s.is_mobile,
         s.mobile_fee,
         sc.category_name
       FROM Service s
       JOIN ServiceCategories sc ON s.category_id = sc.category_id
       WHERE s.workshop_id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '🚫 No services found for this workshop.' });
    }

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching services:', error);
    res.status(500).json({ error: 'Server error while retrieving services.' });
  }
});
router.put('/services/:id', authenticateJWT, async (req, res) => {
  const serviceId = req.params.id;
  const userId = req.user.user_id;
  const { price, is_mobile, mobile_fee } = req.body;

  try {
    // Get workshop_id of the logged-in user
    const workshopResult = await pool.query(
      'SELECT workshop_id FROM Workshops WHERE user_id = $1',
      [userId]
    );

    if (workshopResult.rows.length === 0) {
      return res.status(403).json({ message: '🚫 No workshop found for this user' });
    }

    const workshopId = workshopResult.rows[0].workshop_id;

    // Update only if the service belongs to this workshop
    const updateQuery = `
      UPDATE Service
      SET price = $1,
          is_mobile = $2,
          mobile_fee = $3
      WHERE service_id = $4 AND workshop_id = $5
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, [
      price,
      is_mobile,
      mobile_fee,
      serviceId,
      workshopId
    ]);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: '❌ Service not found or unauthorized' });
    }

    res.json({
      message: '✅ Service updated successfully',
      updatedService: updateResult.rows[0]
    });
  } catch (error) {
    console.error('🚨 Error updating service:', error);
    res.status(500).json({ error: 'Something went wrong while updating the service.' });
  }
});

module.exports = router;