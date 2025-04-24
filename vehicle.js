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
          rv.make,
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
  
  // DELETE /vehicles/:vehicleId
router.delete('/vehicles/:vehicleId', async (req, res) => {
    const vehicleId = req.params.vehicleId;
  
    const client = await pool.connect();
  
    try {
      await client.query('BEGIN');
  
      // Step 1: Delete from Garage if exists
      await client.query(
        'DELETE FROM Garage WHERE vehicle_id = $1',
        [vehicleId]
      );
  
      // Step 2: Delete from Vehicle
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
  
  module.exports = router;