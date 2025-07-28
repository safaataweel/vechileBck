const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const jwt = require('jsonwebtoken'); // تأكد من استيراد jwt

// PostgreSQL Pool setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// JWT authentication middleware
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

router.get('/wallet/balance', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const customerRes = await pool.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );
    if (customerRes.rows.length === 0)
      return res.status(404).json({ message: 'Customer not found' });

    const customerId = customerRes.rows[0].customer_id;

    const walletRes = await pool.query(
      'SELECT balance FROM CustomerWallet WHERE customer_id = $1',
      [customerId]
    );
    if (walletRes.rows.length === 0)
      return res.status(404).json({ message: 'Wallet not found' });

    res.json({ balance: walletRes.rows[0].balance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/wallet/topup', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { amount } = req.body; // المبلغ اللي بدك تضيفه

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const customerRes = await client.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );
    if (customerRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customerId = customerRes.rows[0].customer_id;

    const walletRes = await client.query(
      'SELECT wallet_id, balance FROM CustomerWallet WHERE customer_id = $1',
      [customerId]
    );

    let walletId, newBalance;
    if (walletRes.rows.length === 0) {
      // لو ما في محفظة، انشئ واحدة جديدة
      const insertWalletRes = await client.query(
        'INSERT INTO CustomerWallet (customer_id, balance) VALUES ($1, $2) RETURNING wallet_id',
        [customerId, amount]
      );
      walletId = insertWalletRes.rows[0].wallet_id;
      newBalance = amount;
    } else {
      walletId = walletRes.rows[0].wallet_id;
      newBalance = parseFloat(walletRes.rows[0].balance) + parseFloat(amount);
      await client.query(
        'UPDATE CustomerWallet SET balance = $1, last_updated = CURRENT_TIMESTAMP WHERE wallet_id = $2',
        [newBalance, walletId]
      );
    }

    // سجل المعاملة
    await client.query(
      `INSERT INTO WalletTransactions (wallet_id, amount, transaction_type)
       VALUES ($1, $2, 'adjustment')`,
      [walletId, amount]
    );

    await client.query('COMMIT');
    res.json({ message: 'Wallet topped up successfully', balance: newBalance });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
});

router.post('/wallet/payBooking', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { booking_id, amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // جلب customer_id
    const customerRes = await client.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );
    if (customerRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customerId = customerRes.rows[0].customer_id;

    // جلب المحفظة
    const walletRes = await client.query(
      'SELECT wallet_id, balance FROM CustomerWallet WHERE customer_id = $1',
      [customerId]
    );
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Wallet not found' });
    }
    const { wallet_id, balance } = walletRes.rows[0];

    if (parseFloat(balance) < parseFloat(amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // تحديث الرصيد
    const newBalance = parseFloat(balance) - parseFloat(amount);
    await client.query(
      'UPDATE CustomerWallet SET balance = $1, last_updated = CURRENT_TIMESTAMP WHERE wallet_id = $2',
      [newBalance, wallet_id]
    );

    // إضافة سجل معاملة الدفع
    await client.query(
      `INSERT INTO WalletTransactions (wallet_id, amount, transaction_type, related_booking_id)
       VALUES ($1, $2, 'payment', $3)`,
      [wallet_id, -amount, booking_id]
    );

    // تحديث حالة الحجز مع المبلغ المدفوع (تعديل حسب جدول Booking)
    // هذا مثال يعتمد على جدول الحجز فيه amount_paid وbooking_status
    const bookingRes = await client.query(
      'SELECT amount_paid, total_price, booking_status FROM Booking WHERE booking_id = $1',
      [booking_id]
    );
    if (bookingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found' });
    }
    const booking = bookingRes.rows[0];
    const newAmountPaid = parseFloat(booking.amount_paid) + parseFloat(amount);

    // تحديث حالة الحجز حسب المبلغ الجديد المدفوع
    let newStatus = booking.booking_status;
    if (newAmountPaid >= parseFloat(booking.total_price)) {
      newStatus = 'complete paid';
    } else {
      newStatus = 'accepted partially paid';
    }

    await client.query(
      'UPDATE Booking SET amount_paid = $1, booking_status = $2 WHERE booking_id = $3',
      [newAmountPaid, newStatus, booking_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Payment from wallet successful', balance: newBalance, booking_status: newStatus });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
});

router.post('/wallet/approveRefund', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { booking_id, refund_amount } = req.body;

  if (!refund_amount || refund_amount <= 0) {
    return res.status(400).json({ message: 'Invalid refund amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // جلب customer_id
    const customerRes = await client.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );
    if (customerRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customerId = customerRes.rows[0].customer_id;

    // جلب المحفظة
    const walletRes = await client.query(
      'SELECT wallet_id, balance FROM CustomerWallet WHERE customer_id = $1',
      [customerId]
    );
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Wallet not found' });
    }
    const { wallet_id, balance } = walletRes.rows[0];

    // تحديث الرصيد
    const newBalance = parseFloat(balance) + parseFloat(refund_amount);
    await client.query(
      'UPDATE CustomerWallet SET balance = $1, last_updated = CURRENT_TIMESTAMP WHERE wallet_id = $2',
      [newBalance, wallet_id]
    );

    // إضافة سجل معاملة الاسترداد
    await client.query(
      `INSERT INTO WalletTransactions (wallet_id, amount, transaction_type, related_booking_id)
       VALUES ($1, $2, 'refund', $3)`,
      [wallet_id, refund_amount, booking_id]
    );

    // تحديث حالة الحجز إلى "تمت الموافقة على الاسترداد"
    await client.query(
      'UPDATE Booking SET booking_status = $1 WHERE booking_id = $2',
      ['approved refund', booking_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Refund approved successfully', new_balance: newBalance });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
});

router.get('/wallet/transactions', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const customerRes = await pool.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );
    if (customerRes.rows.length === 0)
      return res.status(404).json({ message: 'Customer not found' });

    const customerId = customerRes.rows[0].customer_id;

   const transactionsRes = await pool.query(
  `SELECT wt.transaction_id, wt.amount, wt.transaction_type, wt.transaction_date, wt.related_booking_id
   FROM WalletTransactions wt
   JOIN CustomerWallet cw ON wt.wallet_id = cw.wallet_id
   WHERE cw.customer_id = $1
   ORDER BY wt.transaction_date DESC`,
  [customerId]
);


    res.json(transactionsRes.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// إضافة مبلغ للمحفظة
router.post('/deposit', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Amount must be a positive number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // الحصول على customer_id
    const customerResult = await client.query(
      'SELECT customer_id FROM Customers WHERE user_id = $1',
      [userId]
    );

    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }

    const customerId = customerResult.rows[0].customer_id;

    // الحصول على wallet_id
    const walletResult = await client.query(
      'SELECT wallet_id FROM CustomerWallet WHERE customer_id = $1',
      [customerId]
    );

    let walletId;
    if (walletResult.rows.length === 0) {
      // إنشاء محفظة إذا مش موجودة
      const newWallet = await client.query(
        'INSERT INTO CustomerWallet (customer_id, balance) VALUES ($1, $2) RETURNING wallet_id',
        [customerId, amount]
      );
      walletId = newWallet.rows[0].wallet_id;
    } else {
      // تحديث الرصيد
      walletId = walletResult.rows[0].wallet_id;
      await client.query(
        `UPDATE CustomerWallet 
         SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
         WHERE wallet_id = $2`,
        [amount, walletId]
      );
    }

    // إضافة المعاملة في سجل المعاملات
    await client.query(
      `INSERT INTO WalletTransactions 
       (wallet_id, amount, transaction_type) 
       VALUES ($1, $2, 'prepayment')`,
      [walletId, amount]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: `₪${amount} added successfully to wallet` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error depositing to wallet:', err);
    res.status(500).json({ message: 'Failed to deposit to wallet' });
  } finally {
    client.release();
  }
});

module.exports = router;