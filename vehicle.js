// GET /vehicles/:userId?type=garage OR type=customer
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

router.get('/vehicles/:userId', async (req, res) => {
    const userId = req.params.userId;
    const type = req.query.type;
  
    let query;
    let values = [userId];
  
    if (type === 'garage') {
      query = `
        SELECT 
          g.garage_id,
          v.vehicle_id,
          v.user_id as owner_id,
          v.registration_date,
          v.quantity,
          rv.make,
          v.isdefault,
          rv.model,
          rv.year,
          rv.transmission,
          rv.engine_size,
          rv.fuel_type
        FROM Garage g
        JOIN Vehicle v ON g.vehicle_id = v.vehicle_id
        JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
        WHERE g.user_id = $1
      `;
    } else {
      query = `
        SELECT 
          v.vehicle_id,
          v.user_id,
          v.registration_date,
          v.quantity,
          v.isdefault,
          rv.make,
          rv.model,
          rv.year,
          rv.transmission,
          rv.engine_size,
          rv.fuel_type
        FROM Vehicle v
        JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
        WHERE v.user_id = $1
      `;
    }
  
    try {
      const { rows } = await pool.query(query, values);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  router.delete('/vehicles/:vehicleId', async (req, res) => {
  const vehicleId = req.params.vehicleId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // تحقق من وجود حجز للسيارة وموعد الحجز >= اليوم (يعني الحجز ما انتهى)
    const bookingCheck = await client.query(
      `SELECT * FROM Booking 
       WHERE vehicle_id = $1 
         AND scheduled_date >= CURRENT_DATE`,
      [vehicleId]
    );

    if (bookingCheck.rowCount > 0) {
      await client.query('ROLLBACK');
return res.status(400).json({ error: 'Cannot delete vehicle with active or upcoming bookings' });
    }

    // حذف من Garage لو موجود
    await client.query(
      'DELETE FROM Garage WHERE vehicle_id = $1',
      [vehicleId]
    );

    // حذف السيارة نفسها
    const result = await client.query(
      'DELETE FROM Vehicle WHERE vehicle_id = $1 RETURNING *',
      [vehicleId]
    );

    await client.query('COMMIT');

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Vehicle not found' });
    } else {
      res.json({ message: 'Vehicle deleted successfully', deletedVehicle: result.rows[0] });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting vehicle:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});


  router.get('/vehicles/default/:userId', async (req, res) => {
  const userId = req.params.userId;

  const query = `
    SELECT 
      v.vehicle_id,
      v.user_id,
      v.registration_date,
      v.quantity,
      rv.make,
      rv.model,
      rv.year,
      rv.transmission,
      rv.engine_size,
      rv.fuel_type
    FROM Vehicle v
    JOIN ReferenceVehicle rv ON v.reference_id = rv.reference_id
    WHERE v.user_id = $1 AND v.isdefault = TRUE
    LIMIT 1
  `;

  try {
    const { rows } = await pool.query(query, [userId]);
    console.log('Default vehicle query executed:', query, 'with userId:', userId);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Default vehicle not found' });
      
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching default vehicle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//set as default vehicle
router.put('/vehicles/default/:vehicleId', async (req, res) => {
  const vehicleId = req.params.vehicleId; 
  const userId = req.body.userId; // Assuming userId is sent in the request body
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Reset all vehicles to not default for the user
    await client.query(
      'UPDATE Vehicle SET isdefault = FALSE WHERE user_id = $1',
      [userId]
    );

    // Step 2: Set the specified vehicle as default
    const result = await client.query(
      'UPDATE Vehicle SET isdefault = TRUE WHERE vehicle_id = $1 AND user_id = $2 RETURNING *',
      [vehicleId, userId]
    );

    await client.query('COMMIT');

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Vehicle not found or not owned by user' });
    }

    res.json({ message: 'Vehicle set as default successfully', updatedVehicle: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error setting default vehicle:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});


  module.exports = router;