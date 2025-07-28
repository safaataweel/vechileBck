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

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded; // Store user info in request for further use
    next();
  });
};

// POST /admin/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Check if user exists in Users table
    const userResult = await pool.query(
      'SELECT * FROM Users WHERE LOWER(TRIM(email_address)) = LOWER(TRIM($1))',
      [email]
    );


    console.log(userResult.rows); // Debugging: check what's in the response

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // 2. Check role is 'Admin'
    if (user.role !== 'Admin') {
      return res.status(403).json({ message: 'Access denied. Not an admin.' });
    }

    // 3. Compare passwords
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    // 4. Get permission_level from Admins table
    const adminResult = await pool.query(
      'SELECT * FROM Admins WHERE user_id = $1',
      [user.user_id]
    );

    if (adminResult.rows.length === 0) {
      return res.status(404).json({ message: 'Admin details not found' });
    }

    const admin = adminResult.rows[0];

    // 5. Generate JWT
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        permission_level: admin.permission_level
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    // 6. Send back token + admin info (avoid sending password or unnecessary sensitive data)
    res.status(200).json({
      token,
      admin: {
        user_id: user.user_id,
        admin_id: admin.admin_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email_address: user.email_address,  // you might want to avoid sending the email back for extra security
        permission_level: admin.permission_level
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/*-----------------------------------------------------------------------------*/
// POST /admin/register
router.post('/register', async (req, res) => {
  const { first_name, last_name, email_address, password, phone_number, profile_picture, permission_level } = req.body;

  try {
    // 1. Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM Users WHERE email_address = $1 OR phone_number = $2',
      [email_address, phone_number]
    );

    if (userExists.rows.length > 0) {
      return res.status(409).json({ message: 'Email or phone number already in use' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Insert into Users
    const userInsert = await pool.query(
      `INSERT INTO Users (profile_picture, first_name, last_name, email_address, password, role, phone_number)
         VALUES ($1, $2, $3, $4, $5, 'Admin', $6) RETURNING user_id`,
      [profile_picture, first_name, last_name, email_address, hashedPassword, phone_number]
    );

    const user_id = userInsert.rows[0].user_id;

    // 4. Insert into Admins
    const adminInsert = await pool.query(
      `INSERT INTO Admins (user_id, permission_level)
         VALUES ($1, $2) RETURNING admin_id`,
      [user_id, permission_level]
    );

    const admin_id = adminInsert.rows[0].admin_id;

    res.status(201).json({
      message: 'Admin registered successfully',
      admin: {
        admin_id,
        user_id,
        first_name,
        last_name,
        email_address,
        permission_level
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});



/*-----------------------------------------------------------------------------*/
router.get('/customers', async (req, res) => {
  try {
    const {

      min_completed = 0,
      min_cancelled = 0,
      min_points = 0,
      name = '',
      email = ''
    } = req.query;

    const values = [];
    let paramIndex = 1;

    let whereClause = `u.role = 'Customer'`;
    if (name) {
      whereClause += ` AND LOWER(u.first_name || ' ' || u.last_name) LIKE LOWER($${paramIndex})`;
      values.push(`%${name.trim().replace(/\s+/g, ' ')}%`);  // Remove extra spaces and allow partial matches
      paramIndex++;
    }

    if (email) {
      whereClause += ` AND LOWER(u.email_address) LIKE LOWER($${paramIndex})`;
      values.push(`%${email.trim()}%`);  // Allow partial match for email
      paramIndex++;
    }

    let havingClause = `
        COALESCE(SUM(CASE WHEN b.booking_status = 'completed' THEN 1 ELSE 0 END), 0) >= $${paramIndex}`;
    values.push(min_completed);
    paramIndex++;

    havingClause += `
        AND COALESCE(SUM(CASE WHEN b.booking_status = 'cancelled' THEN 1 ELSE 0 END), 0) >= $${paramIndex}`;
    values.push(min_cancelled);
    paramIndex++;

    havingClause += `
        AND COALESCE(c.loyalty_points, 0) >= $${paramIndex}`;
    values.push(min_points);
    paramIndex++;

    const query = `
    SELECT 
      c.customer_id, 
      u.user_id,
      u.first_name,
      u.last_name,
      u.email_address,
      u.phone_number,
      COALESCE(SUM(CASE WHEN b.booking_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_bookings,
      COALESCE(SUM(CASE WHEN b.booking_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_bookings,
      COALESCE(SUM(CASE WHEN b.booking_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_bookings,
      COALESCE(c.loyalty_points, 0) AS points
    FROM Users u
    LEFT JOIN Booking b ON u.user_id = b.user_id
    LEFT JOIN Customers c ON u.user_id = c.user_id
    WHERE ${whereClause}
    GROUP BY 
      u.user_id,
      u.first_name,
      u.last_name,
      u.email_address,
      u.phone_number,
      c.loyalty_points,
      c.customer_id
    HAVING ${havingClause}
  `;


    const { rows } = await pool.query(query, values);
    res.status(200).json(rows);
    console.log(query, values); // Log the final query and parameter values

  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /admin/workshops
router.get('/workshops', async (req, res) => {
  try {
    // Extract filter parameters from the query string
    const { name, city, min_rating, service, email, approval_status, emergency_service } = req.query;

    let query = `
        SELECT 
          w.workshop_id,
          w.workshop_name,
          w.rate,
          w.capacity,
          w.working_day_hours,
          w.emergency_service,
          w.mobile_assistance,
          w.approval_status,
          a.city,
          u.phone_number,
          u.email_address,
          COALESCE(
            (
              SELECT AVG(r.rating)
              FROM Review r
              WHERE r.target = 'Workshop' AND r.target_id = w.workshop_id
            ), 0
          ) AS average_rating, 
          (
            SELECT json_agg(
              json_build_object(
                'service_name', s.service_name,
                'price', s.price
              )
            )
            FROM Service s
            WHERE s.workshop_id = w.workshop_id
          ) AS services 
        FROM Workshops w
        JOIN Address a ON w.address_id = a.address_id
        JOIN Users u ON a.user_id = u.user_id
        WHERE 1=1
      `;

    // Apply filters to the query dynamically
    if (name) {
      query += ` AND LOWER(w.workshop_name) LIKE LOWER('%${name}%')`;
    }
    if (city) {
      query += ` AND LOWER(a.city) LIKE LOWER('%${city}%')`;
    }
    if (min_rating) {
      query += ` AND COALESCE((
                      SELECT AVG(r.rating)
                      FROM Review r
                      WHERE r.target = 'Workshop' AND r.target_id = w.workshop_id
                    ), 0) >= ${min_rating}`;
    }
    if (service) {
      query += ` AND EXISTS (
                    SELECT 1
                    FROM Service s
                    WHERE s.workshop_id = w.workshop_id AND LOWER(s.service_name) LIKE LOWER('%${service}%')
                  )`;
    }
    if (email) {
      query += ` AND LOWER(u.email_address) LIKE LOWER('%${email}%')`;
    }
    if (approval_status) {
      query += ` AND w.approval_status = '${approval_status}'`;
    }
    if (emergency_service) {
      query += ` AND w.emergency_service = '${emergency_service}'`;
    }

    // Execute the query
    const { rows } = await pool.query(query);

    // Return the filtered results
    res.status(200).json({ workshops: rows });
  } catch (err) {
    console.error("Error fetching workshops:", err);
    res.status(500).json({ error: "Failed to fetch workshops." });
  }
});
// GET /admin/workshops/basic
router.get('/workshops/basic', async (req, res) => {
  try {
    const query = `
      SELECT 
        w.workshop_id,
        w.workshop_name,
        u.user_id,
        u.email_address
      FROM Workshops w
      JOIN Address a ON w.address_id = a.address_id
      JOIN Users u ON a.user_id = u.user_id
    `;

    const { rows } = await pool.query(query);

    res.status(200).json({ workshops: rows });
  } catch (err) {
    console.error("Error fetching basic workshops:", err);
    res.status(500).json({ error: "Failed to fetch workshops." });
  }
});


// GET all pending workshops
router.get('/workshops/pending', async (req, res) => {
  try {
    const query = `
        SELECT 
          w.workshop_id,
          w.workshop_name,
          w.approval_status,
          w.working_day_hours ,
          a.city,
          a.street,
          u.phone_number,
          u.first_name,
          u.last_name,
          u.email_address
        FROM Workshops w
        JOIN Address a ON w.address_id = a.address_id
        JOIN Users u ON a.user_id = u.user_id
        WHERE w.approval_status = 'Pending';  
      `;

    const { rows } = await pool.query(query);
    res.status(200).json({ workshops: rows });
  } catch (err) {
    console.error("Error fetching workshops:", err);
    res.status(500).json({ error: "Failed to fetch workshops." });
  }
});

// Get all admins
router.get('/admins', async (req, res) => {
  try {
    // Query to fetch all admins along with permission level
    const query = `
        SELECT 
          a.admin_id,
          u.first_name,
          u.last_name,
          u.email_address,
          u.phone_number,
          a.permission_level  -- Add permission_level here
        FROM Admins a
        JOIN Users u ON a.user_id = u.user_id;  
      `;

    const { rows } = await pool.query(query);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No admins found' });
    }

    res.status(200).json({ admins: rows });
  } catch (err) {
    console.error('Error fetching admins:', err);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});
/*-----------------------------------------------------------------------------*/
router.put('/admins/:admin_id', async (req, res) => {
  const { admin_id } = req.params;
  const { permission_level, first_name, last_name, phone_number, email_address } = req.body;
  console.log("Updating admin:", { admin_id, permission_level, first_name, last_name, phone_number, email_address });
  try {
    // Check if admin exists
    const adminCheck = await pool.query('SELECT * FROM Admins WHERE admin_id = $1', [admin_id]);
    if (adminCheck.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }

    // Prepare query for updating fields dynamically
    let updateQueries = [];
    let updateValues = [];
    let queryIndex = 1;
    if (first_name) {
      updateQueries.push(`first_name = $${queryIndex++}`);
      updateValues.push(first_name);
    }

    if (last_name) {
      updateQueries.push(`last_name = $${queryIndex++}`);
      updateValues.push(last_name);
    }

    if (phone_number) {
      // Check if the phone number already exists for another user
      const phoneCheck = await pool.query('SELECT * FROM Users WHERE phone_number = $1 AND user_id != $2', [phone_number, adminCheck.rows[0].user_id]);
      if (phoneCheck.rows.length > 0) {
        return res.status(400).json({ error: "Phone number already in use." });
      }

      updateQueries.push(`phone_number = $${queryIndex++}`);
      updateValues.push(phone_number);
    }

    if (email_address) {
      // Check if the email address already exists for another user
      const emailCheck = await pool.query('SELECT * FROM Users WHERE email_address = $1 AND user_id != $2', [email_address, adminCheck.rows[0].user_id]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: "Email address already in use." });
      }

      updateQueries.push(`email_address = $${queryIndex++}`);
      updateValues.push(email_address);
    }

    // If no fields are provided to update, send the updated admin details.
    if (updateQueries.length > 0) {
      const updateUserQuery = `
          UPDATE Users
          SET ${updateQueries.join(', ')}
          WHERE user_id = $${queryIndex}
          RETURNING user_id;
        `;
      updateValues.push(adminCheck.rows[0].user_id);
      await pool.query(updateUserQuery, updateValues);
    }

    // If permission_level is provided, update it in the Admins table
    if (permission_level !== undefined) {
      const permissionQuery = `
          UPDATE Admins
          SET permission_level = $1
          WHERE admin_id = $2
          RETURNING admin_id, permission_level;
        `;
      const { rows } = await pool.query(permissionQuery, [permission_level, admin_id]);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Admin not found." });
      }

      res.status(200).json({ admin_id: rows[0].admin_id, permission_level: rows[0].permission_level });
    } else {
      res.status(200).json({ message: "Admin details updated successfully" });
    }
  } catch (err) {
    console.error("Error updating admin:", err);
    res.status(500).json({ error: "Failed to update admin." });
  }
});


// update admin permission level by admin id 
router.put('/admins/:admin_id/permission', async (req, res) => {
  const { admin_id } = req.params;
  const { permission_level } = req.body;
  try {
    // Check if admin exists
    const adminCheck = await pool.query('SELECT * FROM Admins WHERE admin_id = $1', [admin_id]);
    if (adminCheck.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }
    // Update permission level
    const updateQuery = 'UPDATE Admins SET permission_level = $1 WHERE admin_id = $2 RETURNING *';
    const { rows } = await pool.query(updateQuery, [permission_level, admin_id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }
    res.status(200).json({ message: "Permission level updated successfully", admin: rows[0] });
  } catch (err) {
    console.error("Error updating admin permission level:", err);
    res.status(500).json({ error: "Failed to update admin permission level." });
  }
});
router.delete('/admins/:admin_id', async (req, res) => {
  const { admin_id } = req.params;

  try {
    // أول شي نجيب user_id المرتبط بـ admin
    const adminResult = await pool.query(
      'SELECT user_id FROM Admins WHERE admin_id = $1',
      [admin_id]
    );

    if (adminResult.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }

    const user_id = adminResult.rows[0].user_id;

    // احذف من Admins
    await pool.query('DELETE FROM Admins WHERE admin_id = $1', [admin_id]);

    // احذف من Users
    await pool.query('DELETE FROM Users WHERE user_id = $1', [user_id]);

    res.status(200).json({ message: "Admin and corresponding user deleted successfully", admin_id, user_id });
  } catch (err) {
    console.error("Error deleting admin and user:", err);
    res.status(500).json({ error: "Failed to delete admin and user." });
  }
});

// Fetch admin details by admin_id
router.get('/admins/:admin_id', async (req, res) => {
  const { admin_id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM Admins WHERE admin_id = $1', [admin_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching admin:", err);
    res.status(500).json({ error: "Failed to fetch admin." });
  }
});
/*-----------------------------------------------------------------------------*/
// ➕ Create Notification (to single user or group)
// router.post('/notifications', async (req, res) => {
//   const { sender_user_id, receiver_user_id, target_group, message, date, notification_type } = req.body;
//   const scheduledDate = new Date(date).toISOString();

//   console.log('Creating notification:', { sender_user_id, receiver_user_id, target_group, message, date, notification_type });
//   try {
//     if (receiver_user_id) {
//       // 📩 Send to single user
//       const result = await pool.query(
//         `INSERT INTO Notification (sender_user_id, receiver_user_id, target_group, message, date, notification_type)
//          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
//         [sender_user_id, receiver_user_id, null, message, scheduledDate, notification_type]
//       );
//       return res.status(201).json(result.rows[0]);
//     } else if (target_group) {
//       let userQuery = "";
//       let values = [];
//       if (target_group.startsWith("admin:")) {
//         const level = parseInt(target_group.split(":")[1]);
//         userQuery = `
//           SELECT U.user_id FROM Users U
//           JOIN Admins A ON U.user_id = A.user_id
//           WHERE A.permission_level = $1`;
//         values = [level];
//       } else if (target_group === "admin") {
//         userQuery = `
//           SELECT U.user_id FROM Users U
//           JOIN Admins A ON U.user_id = A.user_id`;
//       } else {
//         userQuery = `SELECT user_id FROM Users WHERE role = $1`;
//         values = [target_group];
//       }

//       const receivers = await pool.query(userQuery, values);
//       const users = receivers.rows;

//       if (users.length === 0) {
//         return res.status(404).json({ error: "No users found for this target group" });
//       }

//       const insertPromises = users.map(user =>
//         pool.query(
//           `INSERT INTO Notification (sender_user_id, receiver_user_id, target_group, message, date, notification_type)
//            VALUES ($1, $2, $3, $4, $5, $6)`,
//           [sender_user_id, user.user_id, target_group, message, scheduledDate, notification_type]
//         )
//       );

//       await Promise.all(insertPromises);

//       res.status(201).json({ message: `Notifications sent to ${users.length} users in group ${target_group}` });
//     } else {
//       res.status(400).json({ error: "receiver_user_id or target_group is required" });
//     }
//   } catch (err) {
//     console.error("🔥 Error creating notification:", err);
//     res.status(500).json({ error: "Failed to create notification." });
//   }
// });

// ➕ Create Notification (to single user or group)
router.post('/notifications', async (req, res) => {
  try {
    let {
      sender_user_id,
      receiver_user_id,
      target_group,
      message,
      date,
      notification_type,
    } = req.body;

    const scheduledDate = new Date(date).toISOString();

    console.log('Creating notification:', {
      sender_user_id,
      receiver_user_id,
      target_group,
      message,
      date,
      notification_type,
    });

    if (receiver_user_id !== null && receiver_user_id !== undefined) {
      // إرسال إشعار لمستخدم واحد
      const result = await pool.query(
        `INSERT INTO Notification
         (sender_user_id, receiver_user_id, target_group, message, date, notification_type)
         VALUES ($1, $2, null, $3, $4, $5) RETURNING *`,
        [sender_user_id, receiver_user_id, message, scheduledDate, notification_type]
      );
      return res.status(201).json(result.rows[0]);
    } else if (target_group && (receiver_user_id === null || receiver_user_id === undefined)) {
      // إرسال إشعار لمجموعة مستخدمين حسب الدور أو admin level
      let userQuery = "";
      let values = [];

      if (target_group.startsWith("admin:")) {
        const level = parseInt(target_group.split(":")[1]);
        userQuery = `
          SELECT U.user_id FROM Users U
          JOIN Admins A ON U.user_id = A.user_id
          WHERE A.permission_level = $1
        `;
        values = [level];
      } else if (target_group === "admin") {
        userQuery = `
          SELECT U.user_id FROM Users U
          JOIN Admins A ON U.user_id = A.user_id
        `;
      } else {
        // إرسال للمستخدمين حسب الـ role
        userQuery = `SELECT user_id FROM Users WHERE role = $1`;
        values = [target_group];
      }

      const receivers = await pool.query(userQuery, values);
      const users = receivers.rows;

      if (users.length === 0) {
        return res.status(404).json({ error: "No users found for this target group" });
      }

      // إدخال الإشعارات لكل مستخدم في المجموعة مرة واحدة
      const insertPromises = users.map(user =>
        pool.query(
          `INSERT INTO Notification
           (sender_user_id, receiver_user_id, target_group, message, date, notification_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sender_user_id, user.user_id, target_group, message, scheduledDate, notification_type]
        )
      );

      await Promise.all(insertPromises);

      return res.status(201).json({
        message: `Notifications sent to ${users.length} users in group ${target_group}`,
      });
    } else {
      return res.status(400).json({
        error: "receiver_user_id or target_group is required",
      });
    }
  } catch (err) {
    console.error("🔥 Error creating notification:", err);
    return res.status(500).json({ error: "Failed to create notification." });
  }
});


// 📥 Get notifications for a specific user (receiver_user_id)
router.get('/notifications/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM Notification 
       WHERE receiver_user_id = $1 
       ORDER BY date DESC`,
      [userId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching user notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
});

// 🧑‍🤝‍🧑 Get notifications sent to a group
router.get('/notifications/group/:group', async (req, res) => {
  const { group } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM Notification 
       WHERE target_group = $1 
       ORDER BY date DESC`,
      [group]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching group notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
});
// 📋 Get ALL notifications (admin view maybe)

router.get('/notifications', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        n.*,
        u.first_name AS target_first_name,
        u.last_name AS target_last_name
      FROM Notification n
      LEFT JOIN Users u ON n.receiver_user_id = u.user_id
      ORDER BY n.date DESC
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching all notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
});


// ❌ Delete notification by ID: /admin/notifications/:id
router.delete('/notifications/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM Notification WHERE notification_id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found." });
    }
    res.status(200).json({ message: "Notification deleted." });
  } catch (err) {
    console.error("Error deleting notification:", err);
    res.status(500).json({ error: "Failed to delete notification." });
  }
});
// POST: Schedule Notification :admin/schedule
// ✅ Fixed: POST: Schedule Notification with Time Zone Handling
router.post("/schedule", async (req, res) => {
  const { sender_user_id, target_group, message, date, notification_type, admin_permission_level } = req.body;

  if (!sender_user_id || !target_group || !message || !date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const scheduledDate = new Date(date);
    const now = new Date();

    if (scheduledDate <= now) {
      return res.status(400).json({ error: "Scheduled date must be in the future" });
    }

    const result = await pool.query(
      `INSERT INTO Notification (sender_user_id, target_group, message, date, notification_type) 
       VALUES ($1, $2, $3, $4::TIMESTAMPTZ, $5) RETURNING *`,
      [sender_user_id, target_group, message, scheduledDate, notification_type || "scheduled"]
    );

    const notif = result.rows[0];
    const sendTime = new Date(notif.date);
    const cronTime = `${sendTime.getUTCMinutes()} ${sendTime.getUTCHours()} ${sendTime.getUTCDate()} ${sendTime.getUTCMonth() + 1} *`;

    cron.schedule(cronTime, async () => {
      try {
        let usersToNotify = [];

        if (notif.target_group === "admin" && admin_permission_level) {
          // 🔎 Get admin users with specific permission level
          const adminRes = await pool.query(
            `SELECT u.user_id 
             FROM Admins a 
             JOIN Users u ON a.user_id = u.user_id 
             WHERE a.permission_level = $1`,
            [admin_permission_level]
          );
          usersToNotify = adminRes.rows.map(row => row.user_id);
        } else if (notif.target_group === "customer" || notif.target_group === "workshop") {
          const userRes = await pool.query(
            `SELECT user_id FROM Users WHERE role = $1`,
            [notif.target_group]
          );
          usersToNotify = userRes.rows.map(row => row.user_id);
        }

        // 🔔 Send notification to each user
        for (const userId of usersToNotify) {
          await pool.query(
            `INSERT INTO Notification (sender_user_id, receiver_user_id, target_group, message, date, notification_type)
             VALUES ($1, $2, $3, $4, NOW()::TIMESTAMPTZ, $5)`,
            [notif.sender_user_id, userId, notif.target_group, notif.message, "group"]
          );
        }

        console.log(`✅ Notification sent to ${usersToNotify.length} users in ${notif.target_group} at ${new Date().toLocaleString()}`);
      } catch (err) {
        console.error("❌ Error sending scheduled notification:", err);
      }
    });

    res.status(201).json({ message: "Notification scheduled", data: notif });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while scheduling notification" });
  }
});

// ✅ Fixed: POST: Schedule Notification for All Users
router.post("/schedule/all", async (req, res) => {
  const { sender_user_id, message, date, notification_type } = req.body;

  if (!sender_user_id || !message || !date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Parse the incoming date and ensure it's in UTC
    const scheduledDate = new Date(date);
    const now = new Date();

    // Ensure the scheduled date is in the future
    if (scheduledDate <= now) {
      return res.status(400).json({ error: "Scheduled date must be in the future" });
    }

    // ✅ Insert the scheduled notification, not targeting any specific group, sent to all users
    const result = await pool.query(
      `INSERT INTO Notification (sender_user_id, target_group, message, date, notification_type) 
       VALUES ($1, NULL, $2, $3::TIMESTAMPTZ, $4) RETURNING *`, // Targeting all users (no target_group)
      [sender_user_id, message, scheduledDate, notification_type || "scheduled"]
    );

    const notif = result.rows[0];

    // ⏰ Schedule with cron (using UTC time)
    const sendTime = new Date(notif.date);
    const cronTime = `${sendTime.getUTCMinutes()} ${sendTime.getUTCHours()} ${sendTime.getUTCDate()} ${sendTime.getUTCMonth() + 1} *`;

    cron.schedule(cronTime, async () => {
      try {
        // Send notification to all users (insert for each user)
        const usersResult = await pool.query("SELECT user_id FROM Users"); // Assuming Users table has a user_id
        const users = usersResult.rows;

        for (const user of users) {
          await pool.query(
            `INSERT INTO Notification (sender_user_id, target_group, message, date, notification_type) 
             VALUES ($1, $2, $3, NOW()::TIMESTAMPTZ, $4)`,
            [notif.sender_user_id, user.user_id, notif.message, "user"]
          );
        }

        console.log(`✅ Notification sent to all users at ${new Date().toLocaleString()}`);
      } catch (err) {
        console.error("❌ Error sending scheduled notification:", err);
      }
    });

    res.status(201).json({ message: "Notification scheduled for all users", data: notif });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while scheduling notification for all users" });
  }
});
// ✅ Send Notification to All Users Immediately
router.post("/send-to-all", async (req, res) => {
  const { sender_user_id, message, notification_type } = req.body;

  if (!sender_user_id || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // ✅ Insert the notification to the database with NULL target_group (indicating it's for all users)
    const result = await pool.query(
      `INSERT INTO Notification (sender_user_id, target_group, message, date, notification_type) 
       VALUES ($1, NULL, $2, NOW()::TIMESTAMPTZ, $3) RETURNING *`, // For all users
      [sender_user_id, message, notification_type || "general"]
    );

    const notif = result.rows[0];

    // Fetch all users from the database (assuming there's a Users table with user_id)
    const usersResult = await pool.query("SELECT user_id FROM Users");
    const users = usersResult.rows;

    // Send notification to all users immediately
    for (const user of users) {
      await pool.query(
        `INSERT INTO Notification (sender_user_id, target_group, message, date, notification_type) 
         VALUES ($1, $2, $3, NOW()::TIMESTAMPTZ, $4)`,
        [notif.sender_user_id, user.user_id, notif.message, "user"] // Send to each user
      );
    }

    res.status(201).json({ message: "Notification sent to all users", data: notif });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while sending notification to all users" });
  }
});


/*--------------------------------------------------------------offer------------------------------------------------------------------*/

router.post("/offer-types", async (req, res) => {
  const { description, service_category_id, duration, discount_percentage } = req.body;

  if (!description || !service_category_id || !duration || !discount_percentage) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO OfferType (description, service_category_id, duration, discount_percentage) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [description, service_category_id, duration, discount_percentage]
    );
    res.status(201).json({ message: "Offer Type created successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while creating Offer Type" });
  }
});

router.post("/offers", async (req, res) => {
  let {
    offer_type_id,
    start_date,
    end_date,
    target_type,
    total_price,
    title,
    subcategory_ids, // استقبلها من الـ frontend كمصفوفة
  } = req.body;

  let target_id = req.body.target_id || null;

  offer_type_id = parseInt(offer_type_id, 10);
  if (isNaN(offer_type_id)) {
    return res.status(400).json({ error: "offer_type_id must be a valid number" });
  }

  if (target_id !== null) {
    target_id = parseInt(target_id, 10);
    if (isNaN(target_id)) {
      return res.status(400).json({ error: "target_id must be a valid number or null" });
    }
  }

  if (!target_type || !start_date || !end_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!Array.isArray(subcategory_ids) || subcategory_ids.length === 0) {
    return res.status(400).json({ error: "Subcategory IDs must be a non-empty array" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // إدخال العرض
    const offerResult = await client.query(
      `INSERT INTO Offer (offer_type_id, target_id, start_date, end_date, target_type, total_price, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING offer_id`,
      [offer_type_id, target_id, start_date, end_date, target_type, total_price, title]
    );

    const offerId = offerResult.rows[0].offer_id;

    // إدخال كل subcategory_id في جدول OfferServices
    const insertPromises = subcategory_ids.map((subcatId) => {
      return client.query(
        `INSERT INTO OfferServices (offer_id, subcategory_id)
         VALUES ($1, $2)`,
        [offerId, subcatId]
      );
    });

    await Promise.all(insertPromises);

    await client.query("COMMIT");

    res.status(201).json({ message: "Offer created successfully with services", offerId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Server error while creating offer" });
  } finally {
    client.release();
  }
});


router.put("/offers/:offerId", async (req, res) => {
  const { offerId } = req.params;
  const { offer_type_id, target_id, start_date, end_date, target_type, total_price } = req.body;

  if (!offer_type_id || !target_type || !start_date || !end_date || !total_price) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(
      `UPDATE Offer
       SET offer_type_id = $1, target_id = $2, start_date = $3, end_date = $4, total_price = $5 , target_type=$6
       WHERE offer_id = $7
       RETURNING *`,
      [offer_type_id, target_id, start_date, end_date, total_price, target_type, offerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer not found" });
    }

    res.status(200).json({ message: "Offer updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while updating offer" });
  }
});



router.delete("/offers/:offerId", async (req, res) => {
  const { offerId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM Offer WHERE offer_id = $1 RETURNING *`,
      [offerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer not found" });
    }

    res.status(200).json({ message: "Offer deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while deleting offer" });
  }
});

// router.get("/offers", async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT * FROM Offer ORDER BY start_date DESC`
//     );
//     res.status(200).json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Server error while fetching offers" });
//   }
// });
router.get("/offers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.*, 
        json_agg(
          json_build_object(
            'offer_service_id', os.offer_service_id,
            'subcategory_id', sc.subcategory_id,
            'subcategory_name', sc.subcategory_name,
            'price', sc.price,
            'category_id', sc.category_id
          )
        ) AS services
      FROM Offer o
      LEFT JOIN OfferServices os ON o.offer_id = os.offer_id
      LEFT JOIN SubCategories sc ON os.subcategory_id = sc.subcategory_id
      GROUP BY o.offer_id
      ORDER BY o.start_date DESC;
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching offers:", err);
    res.status(500).json({ error: "Server error while fetching offers" });
  }
});

router.get("/offers/offerType/:offerTypeId", async (req, res) => {
  const { offerTypeId } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM Offer WHERE offer_type_id = $1 ORDER BY start_date DESC`,
      [offerTypeId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while fetching offers by offer type" });
  }
});
router.get("/offers/dateRange", async (req, res) => {
  const { start_date, end_date } = req.query; // expect dates in the query string

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "Start date and end date are required" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM Offer WHERE start_date >= $1 AND end_date <= $2 ORDER BY start_date DESC`,
      [start_date, end_date]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while fetching offers by date range" });
  }
});
router.get("/offers/:offerId", async (req, res) => {
  const { offerId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM Offer WHERE offer_id = $1`,
      [offerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while fetching offer by ID" });
  }
});
router.put("/offers/:offerId/status", async (req, res) => {
  const { offerId } = req.params;
  const { status } = req.body; // expect status to be either 'active' or 'inactive'

  if (!status || (status !== "active" && status !== "inactive")) {
    return res.status(400).json({ error: "Invalid status, must be 'active' or 'inactive'" });
  }

  try {
    const result = await pool.query(
      `UPDATE Offer SET status = $1 WHERE offer_id = $2 RETURNING *`,
      [status, offerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer not found" });
    }

    res.status(200).json({ message: "Offer status updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while updating offer status" });
  }
});

// router.get("/offer-types", async (req, res) => {

//   try {
//     const result = await pool.query(
//       `SELECT * FROM OfferType ORDER BY offer_type_id DESC`
//     );
//     res.status(200).json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Server error while fetching offer types" });
//   }
// });


router.get("/offer-types", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ot.*, 
        sc.category_name
      FROM OfferType ot
      LEFT JOIN ServiceCategories sc ON ot.service_category_id = sc.category_id
      ORDER BY ot.offer_type_id DESC;
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching offer types:", err);
    res.status(500).json({ error: "Server error while fetching offer types" });
  }
});

router.put("/offer-types/:offerTypeId", async (req, res) => {
  const { offerTypeId } = req.params;
  const { description, service_category_id, duration, discount_percentage } = req.body;

  if (!description || !service_category_id || !duration || !discount_percentage) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(
      `UPDATE OfferType 
       SET description = $1, service_category_id = $2, duration = $3, discount_percentage = $4
       WHERE offer_type_id = $5
       RETURNING *`,
      [description, service_category_id, duration, discount_percentage, offerTypeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer Type not found" });
    }

    res.status(200).json({ message: "Offer Type updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while updating Offer Type" });
  }
});
router.delete("/offer-types/:offerTypeId", async (req, res) => {
  const { offerTypeId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM OfferType WHERE offer_type_id = $1 RETURNING *`,
      [offerTypeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Offer Type not found" });
    }

    res.status(200).json({ message: "Offer Type deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while deleting Offer Type" });
  }
});

/*--------------------------------------------------------------Booking------------------------------------------------------------------*/
router.get("/Booking", async (req, res) => {
  try {
    const {
      user_id,
      service_id,
      booking_status,
      status_id,
      start_date,
      end_date
    } = req.query;

    // Build the base query
    let query = `SELECT 
                  b.booking_id,
                  b.user_id,
                  u.name AS user_name, 
                  b.service_id,
                  s.service_name, 
                  b.status_id,
                  ss.status_name AS status_name, 
                  b.booking_date,
                  b.scheduled_date,
                  b.completion_date,
                  b.booking_status,
                  b.schedule_id,
                  b.payment_id,
                  b.address_id,
                  a.street AS address_street, 
                  a.city AS address_city
                 FROM Booking b
                 LEFT JOIN Users u ON b.user_id = u.user_id
                 LEFT JOIN Service s ON b.service_id = s.service_id
                 LEFT JOIN ServiceStatus ss ON b.status_id = ss.status_id
                 LEFT JOIN Address a ON b.address_id = a.address_id
                 WHERE 1=1`;  // Placeholder condition to start building dynamic filters

    // Add filters dynamically
    if (user_id) query += ` AND b.user_id = $1`;
    if (service_id) query += ` AND b.service_id = $2`;
    if (booking_status) query += ` AND b.booking_status = $3`;
    if (status_id) query += ` AND b.status_id = $4`;
    if (start_date && end_date) query += ` AND b.booking_date BETWEEN $5 AND $6`;

    query += ` ORDER BY b.booking_date DESC`;  // Sort by booking date

    // Bind the filter parameters
    const values = [
      user_id,
      service_id,
      booking_status,
      status_id,
      start_date,
      end_date
    ].filter(Boolean);  // Remove undefined/null values from the array

    // Execute the query
    const result = await pool.query(query, values);

    // Send the result as a response
    res.status(200).json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while fetching bookings" });
  }
});
// GET booking by booking_id
router.get("/Booking/:booking_id", async (req, res) => {
  const { booking_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM Booking WHERE booking_id = $1`,
      [booking_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while fetching booking" });
  }
});


/*--------------------------------------------------------------Review------------------------------------------------------------------*/

// router.get('/reviews', async (req, res) => {
//   const { target, target_id, rating, review_date } = req.query;

//   let queryParams = [];
//   let conditions = [];

//   // Build WHERE conditions
//   if (target) {
//     conditions.push(`Review.target = $${queryParams.length + 1}`);
//     queryParams.push(target);
//   }

//   if (target_id) {
//     conditions.push(`Review.target_id = $${queryParams.length + 1}`);
//     queryParams.push(target_id);
//   }

//   if (rating) {
//     conditions.push(`Review.rating = $${queryParams.length + 1}`);
//     queryParams.push(rating);
//   }

//   if (review_date) {
//     conditions.push(`Review.review_date = $${queryParams.length + 1}`);
//     queryParams.push(review_date);
//   }

//   // Base query
//   let query = `
//     SELECT Review.*, Workshops.workshop_name, Users.first_name, Users.last_name
//     FROM Review
//     LEFT JOIN Workshops ON Review.target = 'Workshop' AND Review.target_id = Workshops.workshop_id
//     LEFT JOIN Users ON Review.user_id = Users.user_id
//   `;

//   // Add WHERE if needed
//   if (conditions.length > 0) {
//     query += ` WHERE ` + conditions.join(' AND ');
//   }

//   query += ` ORDER BY review_id DESC`;

//   try {
//     const result = await pool.query(query, queryParams);
//     res.status(200).json(result.rows);
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).json({ error: 'Server error while fetching reviews' });
//   }
// });

router.get('/reviews', async (req, res) => {
  const { target, target_id, rating, review_date } = req.query;

  let queryParams = [];
  let conditions = [];

  // Filters
  if (target) {
    conditions.push(`Review.target = $${queryParams.length + 1}`);
    queryParams.push(target);
  }

  if (target_id) {
    conditions.push(`Review.target_id = $${queryParams.length + 1}`);
    queryParams.push(target_id);
  }

  if (rating) {
    conditions.push(`Review.rating = $${queryParams.length + 1}`);
    queryParams.push(rating);
  }

  if (review_date) {
    conditions.push(`Review.review_date = $${queryParams.length + 1}`);
    queryParams.push(review_date);
  }

  // Main query
  let query = `
    SELECT 
      Review.*, 
      Users.first_name || ' ' || Users.last_name AS customer_name,
      Workshops.workshop_name,
      Service.service_name
    FROM Review
    LEFT JOIN Users ON Review.user_id = Users.user_id
    LEFT JOIN Workshops ON Review.workshop_id = Workshops.workshop_id
    LEFT JOIN Service ON Review.service_id = Service.service_id
  `;

  // Add filters if any
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY Review.review_id DESC';

  try {
    const result = await pool.query(query, queryParams);
    res.status(200).json(result.rows);
    console.log(result.rows);
  } catch (err) {
    console.error('Error fetching reviews:', err.message);
    res.status(500).json({ error: 'Server error while fetching reviews' });
  }
});

/*--------------------------------------------------------------Review------------------------------------------------------------------*/
router.get('/dashboard/summary', async (req, res) => {
  try {
    const [users, workshops, bookings, payments] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM Users'),
      pool.query('SELECT COUNT(*) FROM Workshops'),
      pool.query('SELECT COUNT(*) FROM Booking'),
      pool.query('SELECT COALESCE(SUM(income_value), 0) FROM Payment')
    ]);

    res.status(200).json({
      total_users: users.rows[0].count,
      total_workshops: workshops.rows[0].count,
      total_bookings: bookings.rows[0].count,
      total_income: payments.rows[0].coalesce
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});


router.get('/dashboard/upcoming-bookings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT B.booking_id, B.booking_date, B.preferred_time_slot,
             C.name AS customer_name, V.make || ' ' || V.model AS vehicle
      FROM Booking B
      JOIN Customers C ON B.customer_id = C.customer_id
      JOIN Vehicles V ON V.customer_id = C.customer_id
      WHERE B.booking_date >= CURRENT_DATE
      ORDER BY B.booking_date, B.preferred_time_slot
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching upcoming bookings" });
  }
});



router.get('/dashboard/recent-payments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT P.payment_id, P.date, P.income_value, P.payment_type,
             W.workshop_name
      FROM Payment P
      JOIN Booking B ON P.booking_id = B.booking_id
      JOIN Workshops W ON B.workshop_id = W.workshop_id
      WHERE P.date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY P.date DESC
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching recent payments" });
  }
});


router.get('/dashboard/top-workshops', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT W.workshop_id, W.workshop_name, AVG(R.rating) AS avg_rating, COUNT(*) AS review_count
      FROM Workshops W
      JOIN Review R ON R.target_id = W.user_id AND R.target = 'Workshop'
      GROUP BY W.workshop_id, W.workshop_name
      HAVING COUNT(*) > 2
      ORDER BY avg_rating DESC
      LIMIT 5
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching top rated workshops" });
  }
});
router.get('/dashboard/notifications', async (req, res) => {
  const user_id = req.query.user_id; // can be admin or customer or workshop
  try {
    const result = await pool.query(`
      SELECT * FROM Notification
      WHERE recipient = $1 AND status = 'unread'
      ORDER BY timestamp DESC
    `, [user_id]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.delete('/workshops/:workshop_id', async (req, res) => {
  const { workshop_id } = req.params;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Get the user_id associated with the workshop
    const workshopQuery = 'SELECT user_id FROM Workshops WHERE workshop_id = $1';
    const workshopResult = await client.query(workshopQuery, [workshop_id]);

    if (workshopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Workshop not found." });
    }

    const userId = workshopResult.rows[0].user_id;

    // Step 2: Delete all related data
    await client.query('DELETE FROM Service WHERE workshop_id = $1', [workshop_id]);
    await client.query('DELETE FROM WorkshopWorkingHours WHERE workshop_id = $1', [workshop_id]);
    await client.query('DELETE FROM Notification WHERE receiver_user_id = $1', [userId]);

    // Optional: Delete bookings, reviews, offers, etc. here if related

    // Step 3: Delete the workshop
    const deleteWorkshopQuery = 'DELETE FROM Workshops WHERE workshop_id = $1 RETURNING *';
    const { rows: deletedWorkshop } = await client.query(deleteWorkshopQuery, [workshop_id]);

    if (deletedWorkshop.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Failed to delete the workshop." });
    }


    // Step 4: Delete the associated user
    const deleteUserQuery = 'DELETE FROM Users WHERE user_id = $1 RETURNING *';
    const { rows: deletedUser } = await client.query(deleteUserQuery, [userId]);

    if (deletedUser.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Failed to delete the associated user." });
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: "Workshop, related services, and mechanic account deleted successfully.",
      workshop: deletedWorkshop[0],
      user: deletedUser[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error deleting workshop and user:", err);
    res.status(500).json({ error: "Failed to delete workshop and user." });
  } finally {
    client.release();
  }
});
router.delete('/customers/:customer_id', async (req, res) => {
  const { customer_id } = req.params;
  console.log("Deleting customer with ID:", customer_id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 0: Get user_id from customer
    const customerQuery = 'SELECT user_id FROM Customers WHERE customer_id = $1';
    const customerResult = await client.query(customerQuery, [customer_id]);

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Customer not found." });
    }

    const userId = customerResult.rows[0].user_id;

    // Step 1: Delete Maintenance Logs linked to user's vehicles
    await client.query(`
      DELETE FROM MaintenanceLog 
      WHERE vehicle_id IN (
        SELECT vehicle_id FROM Vehicle WHERE user_id = $1
      )
    `, [userId]);

    // Step 2: Delete Garage entries
    await client.query(`
      DELETE FROM Garage 
      WHERE vehicle_id IN (
        SELECT vehicle_id FROM Vehicle WHERE user_id = $1
      )
    `, [userId]);

    // Step 3: Delete Vehicles
    await client.query('DELETE FROM Vehicle WHERE user_id = $1', [userId]);

    // Step 4: Delete Notifications (if applicable)
    await client.query('DELETE FROM Notification WHERE receiver_user_id = $1', [userId]);

    // Optional: Delete Bookings, Reviews, Payments, etc.
    const deleteReviewQuery = 'DELETE FROM Review WHERE user_id = $1';
    const { rows: deletedReviews } = await client.query(deleteReviewQuery, [userId]);
    const deleteBookingQuery = 'DELETE FROM Booking WHERE user_id = $1';
    const { rows: deletedBookings } = await client.query(deleteBookingQuery, [userId]);
    const deletePaymentQuery = 'DELETE FROM Payment WHERE user_id = $1';
    const { rows: deletedPayments } = await client.query(deletePaymentQuery, [userId]);
    const deleteOfferQuery = 'DELETE FROM Offer WHERE target_id = $1 AND target = $2';
    const { rows: deletedOffers } = await client.query(deleteOfferQuery, [userId, 'Customer']);

    // Step 5: Delete Customer
    const deleteCustomerQuery = 'DELETE FROM Customers WHERE customer_id = $1 RETURNING *';
    const { rows: deletedCustomer } = await client.query(deleteCustomerQuery, [customer_id]);

    // Step 6: Delete User
    const deleteUserQuery = 'DELETE FROM Users WHERE user_id = $1 RETURNING *';
    const { rows: deletedUser } = await client.query(deleteUserQuery, [userId]);

    const deleteNotificationQuery = 'DELETE FROM Notification WHERE receiver_user_id = $1';
    const { rows: deletedNotifications } = await client.query(deleteNotificationQuery, [userId]);


    await client.query('COMMIT');

    res.status(200).json({
      bookings: deletedBookings.length > 0 ? deletedBookings : "No bookings found for this user.",
      payments: deletedPayments.length > 0 ? deletedPayments : "No payments found for this user.",
      offers: deletedOffers.length > 0 ? deletedOffers : "No offers found for this user.",
      notifications: deletedNotifications.length > 0 ? deletedNotifications : "No notifications found for this user.",
      reviews: deletedReviews.length > 0 ? deletedReviews : "No reviews found for this user.",
      customer: deletedCustomer[0],
      user: deletedUser[0],
      message: "Customer, related data, and account deleted successfully.",

    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error deleting customer and related data:", err);
    res.status(500).json({ error: "Failed to delete customer and related data." });
  } finally {
    client.release();
  }
});

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const totalWorkshops = await pool.query(`SELECT COUNT(*) FROM Workshops`);
    const activeCustomers = await pool.query(`SELECT COUNT(*) FROM Customers`);
    const monthlyRevenue = await pool.query(`
      SELECT COALESCE(SUM(income_value), 0) AS revenue
      FROM Payment
      WHERE date >= date_trunc('month', CURRENT_DATE)
    `);
    const avgRating = await pool.query(`SELECT ROUND(AVG(rate)::NUMERIC, 2) AS avg_rating FROM Workshops;
`);

    res.json({
      totalWorkshops: parseInt(totalWorkshops.rows[0].count),
      activeCustomers: parseInt(activeCustomers.rows[0].count),
      monthlyRevenue: parseFloat(monthlyRevenue.rows[0].revenue),
      avgRating: parseFloat(avgRating.rows[0].avg_rating)
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// GET /api/dashboard/bookings?type=workshop&range=monthly
router.get('/bookings', async (req, res) => {
  const { type = 'workshop' } = req.query;

  try {
    const data = await pool.query(`
      SELECT TO_CHAR(scheduled_date, 'Mon') AS month,
             COUNT(*) AS bookings
      FROM Booking
      WHERE scheduled_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY month, DATE_PART('month', scheduled_date)
      ORDER BY DATE_PART('month', scheduled_date)
    `);

    res.json(data.rows.map(row => ({
      name: row.month,
      bookings: parseInt(row.bookings)
    })));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// GET /api/dashboard/payments-methods
router.get('/payments-methods', async (req, res) => {
  try {
    const data = await pool.query(`
      SELECT type, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS percentage
      FROM Payment
      GROUP BY type
    `);

    res.json(data.rows.map(row => ({
      name: row.type,
      value: Math.round(row.percentage)
    })));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /admin/workshops/status-counts
router.get('/workshops/status-counts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        approval_status,
        COUNT(*) AS count
      FROM Workshops
      GROUP BY approval_status
    `);

    // نحولها لكائن مرتب:
    const statusCounts = {
      active: 0,
      pending: 0,
      reject: 0,
    };

    result.rows.forEach((row) => {
      const status = row.approval_status.toLowerCase();
      if (status === 'approved') statusCounts.active = parseInt(row.count);
      else if (status === 'pending') statusCounts.pending = parseInt(row.count);
      else if (status === 'reject') statusCounts.suspended = parseInt(row.count);
    });

    res.json(statusCounts);
  } catch (err) {
    console.error('Error getting status counts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// get all cancelation 
router.get('/cancellation', async (req, res) => {
  try {
    const query = `
     SELECT 
  b.booking_id,
  b.scheduled_date AS date,
  u.first_name || ' ' || u.last_name AS customer,
  w.workshop_name AS workshop,
  STRING_AGG(s.service_name, ', ') AS service,
  STRING_AGG(sc.category_name, ', ') AS category,
  b.amount_paid AS amount,
  b.status_name AS status, 
  b.cancelled_at AS time,
  b.cancellation_by,
  b.cancellation_reason AS reason,
  b.refund_issued AS refund_issue,
  b.refund_amount AS refund_amount,
  b.admin_approval AS admin_approval, 
  b.admin_comment AS admin_comment,
  CASE
    WHEN DATE(b.cancelled_at) < b.scheduled_date THEN 'Cancelled Before Scheduled Date'
    WHEN DATE(b.cancelled_at) = b.scheduled_date THEN 'Cancelled On Scheduled Date'
    ELSE 'Cancelled After Scheduled Date'
  END AS cancellation_timing
FROM Booking b
JOIN Users u ON b.user_id = u.user_id
JOIN Workshops w ON b.workshop_id = w.workshop_id
JOIN BookingService bs ON bs.booking_id = b.booking_id
JOIN Service s ON bs.service_id = s.service_id 
JOIN ServiceCategories sc ON s.category_id = sc.category_id
WHERE b.booking_status = 'cancelled'
GROUP BY 
  b.booking_id,
  b.scheduled_date,
  u.first_name,
  u.last_name,
  w.workshop_name,
  b.amount_paid,
  b.status_name,
  b.cancelled_at,
  b.cancellation_by,
  b.cancellation_reason,
  b.refund_issued,
  b.refund_amount,
  b.admin_approval,
  b.admin_comment
ORDER BY b.booking_date DESC;


    `;

    const { rows } = await pool.query(query);
    res.json(rows);
    console.log(rows)
  } catch (error) {
    console.error('Error fetching cancellations:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


router.patch('/cancellation/:bookingId/decision', authenticateJWT, async (req, res) => {
  const { bookingId } = req.params;
  const { adminApproval, adminComment, refundIssued } = req.body;
  const senderUserId = req.user.user_id; // المستخدم اللي عامل القرار

  if (!adminApproval || !['approved', 'rejected', 'pending'].includes(adminApproval)) {
    return res.status(400).json({ error: 'Invalid or missing adminApproval value' });
  }

  try {
    // جلب اليوزر المستلم (الكستمر) من البوكينغ
    const getBookingUserQuery = `SELECT user_id FROM Booking WHERE booking_id = $1`;
    const bookingUserRes = await pool.query(getBookingUserQuery, [bookingId]);
    if (bookingUserRes.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const receiverUserId = bookingUserRes.rows[0].user_id;

    // تحديث حالة البوكينغ
    const updateBookingQuery = `
      UPDATE Booking
      SET admin_approval = $1,
          admin_comment = $2,
          refund_issued = $3
      WHERE booking_id = $4
      RETURNING booking_id, admin_approval, admin_comment, refund_issued;
    `;

    const updateValues = [
      adminApproval,
      adminComment || null,
      refundIssued !== undefined ? refundIssued : null,
      bookingId,
    ];

    const { rows } = await pool.query(updateBookingQuery, updateValues);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // إنشاء رسالة النوتيفيكاشن
    let message = '';
    if (adminApproval === 'approved') {
      message = 'Your cancellation refund has been approved.';
    } else if (adminApproval === 'rejected') {
      message = 'Your cancellation refund request has been rejected.';
    } else {
      message = 'Your cancellation refund request is pending review.';
    }
    if (adminComment) {
      message += ` Admin comment: ${adminComment}`;
    }

    const insertNotificationQuery = `
      INSERT INTO Notification (sender_user_id, receiver_user_id, message, date, notification_type, target_group, is_read)
      VALUES ($1, $2, $3, CURRENT_DATE, 'Cancellation Decision', 'customer', false)
      RETURNING notification_id;
    `;

    await pool.query(insertNotificationQuery, [
      senderUserId,
      receiverUserId,
      message,
    ]);

    res.json({
      message: 'Admin decision updated and notification sent successfully',
      booking: rows[0],
    });
  } catch (error) {
    console.error('Error updating admin decision and sending notification:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// route to approve/reject the offer 
router.patch('/offer/:offerId/status', async (req, res) => {
  const { offerId } = req.params;
  const { statusOffer, rejection_reason } = req.body;

  const allowedStatuses = ['accepted', 'rejected', 'pinned', 'pending'];

  if (!allowedStatuses.includes(statusOffer)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  if (statusOffer === 'rejected' && (!rejection_reason || rejection_reason.trim() === '')) {
    return res.status(400).json({ error: 'Rejection reason is required for rejected offers' });
  }

  try {
    const query = `
      UPDATE Offer
      SET statusOffer = $1,
          rejection_reason = $2
      WHERE offer_id = $3
RETURNING offer_id, statusOffer, rejection_reason;
    `;

    const values = [
      statusOffer,
      statusOffer === 'rejected' ? rejection_reason : null,
      offerId,
    ];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json({ message: 'Offer status updated', offer: rows[0] });
  } catch (error) {
    console.error('Error updating offer status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const nodemailer = require("nodemailer");

router.post("/send-email", async (req, res) => {
  const { to, subject, html } = req.body;

  // إعداد nodemailer transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.your-email-provider.com", // زي smtp.gmail.com/reviews
    port: 587,
    secure: false,
    auth: {
      user: "your@email.com", // ✨ بريدك الفعلي
      pass: "yourEmailPasswordOrAppPassword", // ✨ كلمة مرور البريد أو App Password
    },
  });

  try {
    await transporter.sendMail({
      from: `"Your App Name" <your@email.com>`,
      to,
      subject,
      html,
    });

    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Email error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

router.get('/dashboard-payment', async (req, res) => {
  try {
    const revenueQuery = `
  SELECT 
    TO_CHAR(p.date, 'Mon') AS month,
    SUM(p.income_value) AS revenue,
    SUM(p.income_value * (p.percent_to_admin / 100)) AS profit
  FROM Payment p
  GROUP BY TO_CHAR(p.date, 'Mon')
  ORDER BY MIN(p.date)
`;


    const categoryQuery = `
      SELECT 
        sc.category_name AS name,
        SUM(p.income_value * (p.percent_to_admin / 100)) AS profit
      FROM Payment p
      JOIN Booking b ON p.booking_id = b.booking_id
      JOIN BookingService bs ON b.booking_id = bs.booking_id
JOIN Service s ON bs.service_id = s.service_id
      JOIN ServiceCategories sc ON s.category_id = sc.category_id
      GROUP BY sc.category_name;
    `;

    const serviceQuery = `
      SELECT 
        s.service_name AS name,
        sc.category_name AS category,
        SUM(p.income_value * (p.percent_to_admin / 100)) AS profit
      FROM Payment p
      JOIN Booking b ON p.booking_id = b.booking_id
JOIN BookingService bs ON b.booking_id = bs.booking_id
JOIN Service s ON bs.service_id = s.service_id      
JOIN ServiceCategories sc ON s.category_id = sc.category_id
      GROUP BY s.service_name, sc.category_name;
    `;

    const workshopQuery = `
      SELECT 
        w.workshop_name AS name,
        SUM(p.income_value * (p.percent_to_admin / 100)) AS profit
      FROM Payment p
      JOIN Booking b ON p.booking_id = b.booking_id
      JOIN Workshops w ON b.workshop_id = w.workshop_id
      GROUP BY w.workshop_name;
    `;

    const paymentMethodQuery = `
      SELECT 
        type AS name,
        COUNT(*) AS transactions,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()), 1) AS usage
      FROM Payment
      GROUP BY type;
    `;
const result = await pool.query(`
  SELECT 
    COALESCE(SUM(income_value), 0) AS total_revenue,
    COALESCE(SUM(income_value * percent_to_admin), 0) AS admin_earnings
  FROM Payment
`);

const totalRevenue = result.rows[0].total_revenue;
const adminEarnings = result.rows[0].admin_earnings;

const netProfit = totalRevenue - adminEarnings;

    const [
      
      revenueResult,
      categoryResult,
      serviceResult,
      workshopResult,
      paymentResult,
    ] = await Promise.all([
      pool.query(revenueQuery),
      pool.query(categoryQuery),
      pool.query(serviceQuery),
      pool.query(workshopQuery),
      pool.query(paymentMethodQuery),
    ]);

    res.json({
      netProfit : netProfit,
  
  
      revenueData: revenueResult.rows,
      categoriesData: categoryResult.rows,
      servicesData: serviceResult.rows,
      workshopsData: workshopResult.rows,
      paymentMethodsData: paymentResult.rows,
    });
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

module.exports = router;
