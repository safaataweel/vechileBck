const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

require('dotenv').config();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const cron = require("node-cron");
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
// route to get all the reviews for a workshop
router.get('/workshop/:workshopId', async (req, res) => {
    const workshopId = req.params.workshopId;
    const client = await pool.connect();
    try {
        const query = `
      SELECT DISTINCT 
        s.service_id,
        s.service_name,
        s.price,
        s.service_description,
        AVG(r.rating) AS average_rating,
        COUNT(r.review_id) AS total_reviews
      FROM Service s
      JOIN Review r ON s.service_id = r.service_id
      WHERE s.workshop_id = $1
        AND r.target = 'Service'
      GROUP BY s.service_id
      ORDER BY average_rating DESC
    `;

        const result = await client.query(query, [workshopId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching reviewed services:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});
router.get('/services-with-reviews', authenticateJWT, async (req, res) => {
    const userId = req.user.user_id; // أخذنا user_id من التوكن
    const client = await pool.connect();

    try {
        // نجيب workshop_id المرتبط بالمستخدم
        const workshopResult = await client.query(
            'SELECT workshop_id FROM Workshops WHERE user_id = $1',
            [userId]
        );

        if (workshopResult.rows.length === 0) {
            return res.status(404).json({ message: 'Workshop not found for this user' });
        }

        const workshopId = workshopResult.rows[0].workshop_id;

        // نجيب الخدمات يلي عليها تقييمات من هاي الورشة
        const query = `
      SELECT DISTINCT 
        s.service_id,
        s.service_name,
        s.price,
        s.service_description,
        AVG(r.rating) AS average_rating,
        COUNT(r.review_id) AS total_reviews
      FROM Service s
      JOIN Review r ON s.service_id = r.service_id
      WHERE s.workshop_id = $1
        AND r.target = 'Service'
      GROUP BY s.service_id
      ORDER BY average_rating DESC
    `;

        const result = await client.query(query, [workshopId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching reviewed services:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// route to get a review for a service 
router.get('/service/:serviceId', async (req, res) => {
    const serviceId = req.params.serviceId;
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT r.review_id, r.rating, r.comment, u.first_name, u.last_name
            FROM Reviews r
            JOIN Users u ON r.user_id = u.user_id
            WHERE r.service_id = $1
        `, [serviceId]);

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});


// 1. Get negative reviews
router.get('/reviews/negative', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.review_id, r.comment, r.rating, r.review_date, r.target, r.target_id,
                   u.first_name || ' ' || u.last_name AS reviewer
            FROM Review r
            JOIN Users u ON r.user_id = u.user_id
            WHERE r.rating <= 2
            ORDER BY r.review_date DESC;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/workshops/complaints', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT 
        w.workshop_id, 
        w.workshop_name, 
        u.email_address,
        COUNT(r.review_id) AS complaints
      FROM Review r
      JOIN Workshops w ON r.workshop_id = w.workshop_id
      JOIN Users u ON w.user_id = u.user_id
      WHERE r.target = 'Workshop' AND r.rating <= 2
      GROUP BY w.workshop_id, w.workshop_name, u.email_address
      ORDER BY complaints DESC;
    `);

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching workshop complaints:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/workshops/:id/warning', async (req, res) => {
    const { id } = req.params;
    const { message } = req.body; // ← هيك بنجيب الرسالة من الريكوست

    if (!message) {
        return res.status(400).json({ error: 'Warning message is required' });
    }

    try {
        // 1. زيّدي نقطة تحذير
        const result = await pool.query(`
      UPDATE Workshops
      SET warning_point = warning_point + 1
      WHERE workshop_id = $1
      RETURNING workshop_id, workshop_name, warning_point, user_id;
    `, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Workshop not found' });
        }

        const workshop = result.rows[0];
        const receiver_user_id = workshop.user_id;

        // 2. إرسال إشعار بالرسالة الجايه من البودي
        await pool.query(`
      INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type, target_group, is_read)
      VALUES ($1, $2, $3, CURRENT_DATE, 'Warning', 'Workshop', false)
    `, [1, receiver_user_id, message]); // 1 = admin (ثبّتيها أو خليها من التوكن)

        // 3. رد
        res.status(200).json({
            message: 'Warning point incremented and custom notification sent',
            warning_point: workshop.warning_point, // هذي قديمة، نعدلها
        });
    } catch (err) {
        console.error('Error updating warning point:', err.message);
        res.status(500).json({ error: 'Server error while updating warning point' });
    }
});

router.get('/workshops/warnings', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT workshop_id, workshop_name, warning_point
      FROM Workshops
      ORDER BY warning_point DESC
    `);

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching warning points:', err.message);
        res.status(500).json({ error: 'Server error while fetching warning points' });
    }
});

// 3. Most complained-about service
router.get('/services/most-complained', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.service_id, s.service_name, COUNT(r.review_id) AS complaints
            FROM Review r
            JOIN Service s ON r.service_id = s.service_id
            WHERE r.target = 'Service' AND r.rating <= 2
            GROUP BY s.service_id, s.service_name
            ORDER BY complaints DESC
            LIMIT 1;
        `);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// 4. Complaint details
router.get('/complaints/details', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                r.review_id, r.rating, r.comment, r.review_date,
                u.first_name || ' ' || u.last_name AS user_name,
                ws_user.first_name || ' ' || ws_user.last_name AS workshop_name,
                s.service_name
            FROM Review r
            LEFT JOIN Users u ON r.user_id = u.user_id
            LEFT JOIN Workshops w ON r.workshop_id = w.workshop_id
            LEFT JOIN Users ws_user ON w.user_id = ws_user.user_id
            LEFT JOIN Service s ON r.service_id = s.service_id
            WHERE r.rating <= 2
            ORDER BY r.review_date DESC;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// في ملف الـ routes
router.get('/workshops/most-complained', async (req, res) => {
    try {
        const result = await pool.query(`
           SELECT 
    w.workshop_id,
    w.workshop_name,
    u.first_name || ' ' || u.last_name AS workshop_owner,
    COUNT(r.review_id) AS complaints
FROM Review r
JOIN Workshops w ON r.workshop_id = w.workshop_id
JOIN Users u ON w.user_id = u.user_id
WHERE r.target = 'Workshop' AND r.rating <= 2
GROUP BY w.workshop_id, w.workshop_name, u.first_name, u.last_name
ORDER BY complaints DESC
LIMIT 1;

        `);
        res.json({ workshop_name: result.rows[0]?.workshop_name });

        console.log(`Most complained workshop: ${result.rows[0]?.workshop_name}`);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Services grouped by complaint count
router.get('/services/complaints', async (_, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT s.service_id,
             s.service_name     AS name,
             COUNT(r.review_id) AS complaints
      FROM   Review r
      JOIN   Service s ON r.service_id = s.service_id
      WHERE  r.target = 'Service' AND r.rating <= 2
      GROUP  BY s.service_id, s.service_name
      ORDER  BY complaints DESC;
    `);
        res.json(rows);                         // [{name:'Brake Pads', complaints:3}, ...]
    } catch (err) { res.status(500).json({ error: 'server-oops' }); }
});


// route to delete a review
router.delete('/review/:reviewId', async (req, res) => {
    const reviewId = req.params.reviewId;
    const client = await pool.connect();
    try {
        const result = await client.query(`
            DELETE FROM Review
            WHERE review_id = $1
        `, [reviewId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Review not found' });
        }

        res.status(200).json({ message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});
// File: routes/review.js
router.get('/review/workshops/summary', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
     SELECT 
  w.workshop_id,
  w.workshop_name,
  ROUND(AVG(r.rating)::numeric, 1) AS average_rating,
  COUNT(r.review_id) AS total_reviews,
  STRING_AGG(DISTINCT s.service_name, ', ') AS services_offered
FROM Workshops w
LEFT JOIN Review r ON w.workshop_id = r.workshop_id
LEFT JOIN Service s ON s.workshop_id = w.workshop_id
GROUP BY w.workshop_id, w.workshop_name
ORDER BY average_rating DESC NULLS LAST;

    `);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching workshop performance summary:', err);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.get('/review/all', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
      SELECT 
        r.review_id AS id,
        r.rating,
        r.comment,
        r.review_date AS date,
        CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
        w.workshop_name AS workshop_name,
        w.workshop_id,
        s.service_name AS service,
        sc.category_name AS service_category
      FROM Review r
      JOIN Users u ON u.user_id = r.user_id
      JOIN Workshops w ON w.workshop_id = r.workshop_id
      LEFT JOIN Service s ON s.service_id = r.service_id
      LEFT JOIN ServiceCategories sc ON sc.category_id = s.category_id
      ORDER BY r.review_date DESC;
    `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching all reviews:', err);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// route to add a review
router.post('/review', authenticateJWT, async (req, res) => {
    const { workshopId, serviceId, rating, comment } = req.body;
    const userId = req.user.user_id; // Get userId from the token
    console.log('User ID from token:', userId);
    const client = await pool.connect();
    const target = 'Workshop';
    const target_id = serviceId;
    const review_date = new Date(); // التاريخ الحالي

    try {
        const result = await client.query(`
            INSERT INTO Review (user_id, workshop_id, service_id, target, target_id, rating, comment, review_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING review_id
        `, [userId, workshopId, serviceId, target, target_id, rating, comment, review_date]);

        res.status(201).json({ reviewId: result.rows[0].review_id });
    } catch (error) {
        console.error('Error adding review:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router; 