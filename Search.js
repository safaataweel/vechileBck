const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();

const jwt = require('jsonwebtoken');

// PostgreSQL Pool setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.get('/search', async (req, res) => {
  const { searchQuery, minPrice, maxPrice, locationId, minRating, mobileAssistance } = req.query;

  // Start building the query
  let query = `
        SELECT 
            s.service_id, 
            s.service_name, 
            s.service_description, 
            s.price, 
            w.workshop_name, 
            w.rate, 
            w.mobile_assistance, 
            w.capacity, 
            w.current_occupancy,
            ts_rank(to_tsvector('english', s.service_name || ' ' || s.service_description), to_tsquery('english', $1)) AS rank
        FROM 
            Service s
        JOIN 
            Workshops w ON s.workshop_id = w.workshop_id
        WHERE 
            (
                to_tsvector('english', s.service_name || ' ' || s.service_description) @@ to_tsquery('english', $1)
                OR s.service_name % $2
                OR s.service_description % $3
            )
    `;

  // Setup parameters
  let queryParams = [`${searchQuery}:*`, searchQuery, searchQuery];
  let paramIndex = queryParams.length + 1; // Keep track of next $ index

  // Filters
  if (minPrice && maxPrice) {
    query += ` AND s.price BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
    queryParams.push(minPrice, maxPrice);
    paramIndex += 2;
  }

  if (locationId) {
    query += ` AND w.address_id = $${paramIndex}`;
    queryParams.push(locationId);
    paramIndex++;
  }

  if (minRating) {
    query += ` AND w.rate >= $${paramIndex}`;
    queryParams.push(minRating);
    paramIndex++;
  }

  if (mobileAssistance !== undefined) {
    query += ` AND w.mobile_assistance = $${paramIndex}`;
    queryParams.push(mobileAssistance === 'true');
    paramIndex++;
  }

  // Order by relevance and rating
  query += ` ORDER BY w.rate DESC `;

  try {
    const results = await pool.query(query, queryParams);
    res.json(results.rows);
  } catch (error) {
    console.error("Error querying the database:", error);
    res.status(500).send("Internal server error");
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

async function getUserCartSubcategories(userId) {
  const res = await pool.query(`
    SELECT subcategory_id FROM carts WHERE user_id = $1
  `, [userId]);
  return res.rows.map(row => row.subcategory_id);
}
async function getWorkshopsWithServices(subcategoryIds) {
  const res =  await pool.query(`
  SELECT 
    w.workshop_id,
    w.workshop_name,
    w.rate,
    u.profile_picture,
    a.city,
    a.street,
    s.subcategory_id,
    s.service_id,
    s.price,
    s.service_name,
    s.estimated_duration,
    s.is_mobile,
    s.mobile_fee,
    w.pickup_fee,
    w.pickup_service_available

  FROM workshops w
  JOIN service s ON w.workshop_id = s.workshop_id
  JOIN users u ON w.user_id = u.user_id
  JOIN address a ON w.address_id = a.address_id
  WHERE s.subcategory_id = ANY($1)
`, [subcategoryIds]);
  
  const grouped = {};
  for (const row of res.rows) {
    if (!grouped[row.workshop_id]) {
     grouped[row.workshop_id] = {
  workshop_name: row.workshop_name,
  profile_picture: row.profile_picture,
  city: row.city,
  street: row.street,
  pickup_service_available: row.pickup_service_available || false,
  pickup_fee: row.pickup_fee || 0 ,
  services: [],
  serviceDetails: [],
  rate: row.rate
     
};
console.log('New workshop added:', row.city, row.street, row.workshop_name,row.pickup_service_available );
    }
    grouped[row.workshop_id].services.push(row.subcategory_id);
    grouped[row.workshop_id].serviceDetails.push({
      service_id: row.service_id,
      name: row.service_name,
      price: row.price,
      duration: row.estimated_duration || 60,
      is_mobile: row.is_mobile || false,
      mobile_fee: row.mobile_fee || 0
    });
  }

  return grouped;
}

async function getSchedule(workshopId, dayOfWeek) {
  const res = await pool.query(`
    SELECT * FROM WorkshopWorkingHours
    WHERE workshop_id = $1 AND day_of_week = $2
  `, [workshopId, dayOfWeek]);
  return res.rows;
}
async function findPerfectAndPartialMatches(workshopsGrouped, subcategoryIds, preferred_time, dayOfWeek, pool) {
  const perfectMatch = [];
  const partialMatch = [];

  for (const [workshop_id, data] of Object.entries(workshopsGrouped)) {
    const workshopServices = [...new Set(data.services)];
    const hasAllServices = subcategoryIds.every(id => workshopServices.includes(id));

    const scheduleRes = await pool.query(`
      SELECT * FROM WorkshopWorkingHours
      WHERE workshop_id = $1 AND day_of_week = $2
    `, [workshop_id, dayOfWeek]);

    const isOpenToday = scheduleRes.rows.length > 0;
    if (!isOpenToday) continue;

    const timeAvailable = scheduleRes.rows.some(row => {
      return preferred_time >= row.start_time && preferred_time <= row.end_time;
    });

    const isNearTime = scheduleRes.rows.some(row => {
      const startHour = parseInt(row.start_time.split(':')[0]);
      const endHour = parseInt(row.end_time.split(':')[0]);
      const preferredHour = parseInt(preferred_time.split(':')[0]);
      return Math.abs(preferredHour - startHour) <= 1 || Math.abs(preferredHour - endHour) <= 1;
    });

    if (hasAllServices && timeAvailable) {
perfectMatch.push({
  workshop_id,
  workshop_name: data.workshop_name,
  rate: data.rate,
  services: data.serviceDetails,
  profile_picture: data.profile_picture,
  city: data.city,

  street: data.street,
  pickup_service_available: data.pickup_service_available||false,
  pickup_fee: data.pickup_fee || 0
});
console.log('Perfect match found:', data.workshop_name, data.city, data.street);
    } else if (hasAllServices && isNearTime) {
      partialMatch.push({ workshop_id, workshop_name: data.workshop_name, services: data.serviceDetails });
    }
  }

  return { perfectMatch, partialMatch };
}

async function findSplitMatches(subcategoryIds, preferred_time, dayOfWeek, pool) {
  const servicesPerSubcategory = [];

  // 🔄 دالة لتحويل الوقت من "09:00 AM" إلى ساعات ودقائق
  function parse12HourTime(timeStr) {
    const [time, modifier] = timeStr.trim().split(" ");
    let [hourStr, minuteStr] = time.split(":");
    let hours = parseInt(hourStr, 10);
    const minutes = parseInt(minuteStr, 10);

    if (modifier === "PM" && hours !== 12) hours += 12;
    else if (modifier === "AM" && hours === 12) hours = 0;

    return { hours, minutes };
  }

  // ⏱️ حساب الوقت المفضل بالدقائق
  const { hours: preferredHour, minutes: preferredMin } = parse12HourTime(preferred_time);
  const preferredMinutes = preferredHour * 60 + preferredMin;

  console.log(`Preferred time in minutes: ${preferredMinutes}`);

  for (const subcategory_id of subcategoryIds) {
    const res = await pool.query(`
      SELECT s.service_id, s.service_name, s.price, s.subcategory_id, s.estimated_duration,  s.is_mobile,
    s.mobile_fee,
             w.workshop_id, w.workshop_name, w.rate
      FROM service s
      JOIN workshops w ON s.workshop_id = w.workshop_id
      WHERE s.subcategory_id = $1
    `, [subcategory_id]);

    const matches = [];

    for (const row of res.rows) {
      const scheduleRes = await pool.query(`
        SELECT * FROM WorkshopWorkingHours
        WHERE workshop_id = $1 AND day_of_week = $2
      `, [row.workshop_id, dayOfWeek]);

      const duration = row.estimated_duration || 60; // ⏳ احسب مدة كل خدمة

      for (const schedule of scheduleRes.rows) {
        const [startH, startM] = schedule.start_time.split(':').map(Number);
        const [endH, endM] = schedule.end_time.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        let timeSlot = Math.max(preferredMinutes, startMinutes);

        if (timeSlot + duration <= endMinutes) {
          matches.push({
            workshop_id: row.workshop_id,
            workshop_name: row.workshop_name,
            time: `${String(Math.floor(timeSlot / 60)).padStart(2, '0')}:${String(timeSlot % 60).padStart(2, '0')}`,
            service: {
              id: row.service_id,
              name: row.service_name,
              price: row.price,
              duration: duration,
             
            },
            rating: row.rate,
            time_in_minutes: timeSlot,
          });
          break;
        }
      }
    }

    if (matches.length === 0) {
      console.log(`❌ No workshops found for subcategory ${subcategory_id}`);
      continue;
    }

    servicesPerSubcategory.push(matches);
    console.log(`✅ Found ${matches.length} matches for subcategory ${subcategory_id}`);
  }

  // 🧠 توليد كل التركيبات الممكنة (cartesian product)
  function cartesianProduct(arrays, index = 0, current = [], result = []) {
    if (index === arrays.length) {
      result.push(current);
      return result;
    }
    for (const item of arrays[index]) {
      cartesianProduct(arrays, index + 1, [...current, item], result);
    }
    return result;
  }

  const allCombinations = cartesianProduct(servicesPerSubcategory);

  const smartCombinations = allCombinations
    .filter(combo => {
      const uniqueWorkshops = new Set(combo.map(item => item.workshop_id));
      return uniqueWorkshops.size <= 2;
    })
    .map(combo => {
      const grouped = {};
      for (const item of combo) {
        if (!grouped[item.workshop_id]) {
          grouped[item.workshop_id] = {
            workshop: item,
            services: [],
            totalDuration: 0,
          };
        }
        grouped[item.workshop_id].services.push(item.service);
        grouped[item.workshop_id].totalDuration += item.service.duration;
      }

      const sortedGroups = Object.values(grouped).sort((a, b) => b.services.length - a.services.length);
      let currentTime = Number(combo[0].time_in_minutes);
      const result = [];

      for (const group of sortedGroups) {
        for (const s of group.services) {
          result.push({
            ...group.workshop,
            time: `${String(Math.floor(currentTime / 60)).padStart(2, '0')}:${String(currentTime % 60).padStart(2, '0')}`,
            service: s,
          });
          currentTime += s.duration;
        }
        currentTime += 60; // ⏱️ بريك بين الورش
      }

      return result;
    });

  // ⬇️ ترتيب النتائج حسب السعر
  smartCombinations.sort((a, b) => {
    const totalA = a.reduce((sum, item) => sum + item.service.price, 0);
    const totalB = b.reduce((sum, item) => sum + item.service.price, 0);
    return totalA - totalB;
  });

  return smartCombinations.slice(0, 10);
}


function sortMatches(matches, sortBy, order = 'asc') {
  const sorted = [...matches];
  const direction = order === 'desc' ? -1 : 1;

  sorted.sort((a, b) => {
    if (sortBy === 'rate') {
      return (a.rate - b.rate) * direction;
    } else if (sortBy === 'price') {
      // نحسب أقل سعر خدمة بكل ورشة
      const aMin = Math.min(...a.services.map(s => s.price));
      const bMin = Math.min(...b.services.map(s => s.price));
      return (aMin - bMin) * direction;
    } else {
      return 0; // ما في ترتيب معين
    }
  });

  return sorted;
}
function filterWorkshops(workshops, { minPrice, maxPrice, minRating, mobileAssistance }) {
  return workshops.filter(w => {
    const allPrices = w.services.map(s => s.price);
    const minServicePrice = Math.min(...allPrices);

    return (!minPrice || minServicePrice >= minPrice) &&
           (!maxPrice || minServicePrice <= maxPrice) &&
           (!minRating || w.rate >= minRating);
           // لاحقاً أضيفي شرط الـ mobileAssistance حسب ما يتوفر عندك بالـ DB
  });
}

router.post('/search-available-workshops', authenticateJWT, async (req, res) => {
  const userId = req.user.user_id;
  const { preferred_date, preferred_time, minPrice, maxPrice, locationId, minRating, mobileAssistance, sortBy, order } = req.body;
  const dayOfWeek = new Date(preferred_date).getDay();

  try {
    const cartServicesRes = await pool.query(`
      SELECT subcategory_id FROM carts WHERE user_id = $1
    `, [userId]);

    if (cartServicesRes.rows.length === 0) {
      return res.status(200).json({ perfectMatch: [], partialMatch: [], splitMatch: [] });
    }

    const subcategoryIds = cartServicesRes.rows.map(row => row.subcategory_id);

    const workshopsRes = await pool.query(`
  SELECT 
    w.workshop_id,
    w.workshop_name,
    w.rate,
     w.pickup_fee,
    w.pickup_service_available,
    u.profile_picture,
    a.city,
    a.street,
    s.subcategory_id,
    s.service_id,
    s.price,
    s.service_name,
    s.estimated_duration,
    'is_mobile', s.is_mobile,
    'mobile_fee', s.mobile_fee
  FROM workshops w
  JOIN service s ON w.workshop_id = s.workshop_id
  JOIN users u ON w.user_id = u.user_id
  JOIN address a ON w.address_id = a.address_id
  WHERE s.subcategory_id = ANY($1)
`, [subcategoryIds]);

   const workshopsGrouped = await getWorkshopsWithServices(subcategoryIds);

let { perfectMatch, partialMatch } = await findPerfectAndPartialMatches(workshopsGrouped, subcategoryIds, preferred_time, dayOfWeek, pool);

// ✨ فلترة إضافية بعد ما جبتي الماتشات:
perfectMatch = filterWorkshops(perfectMatch, { minPrice, maxPrice, minRating, mobileAssistance });
partialMatch = filterWorkshops(partialMatch, { minPrice, maxPrice, minRating, mobileAssistance });

let splitMatch = [];
if (perfectMatch.length === 0 && partialMatch.length === 0) {
  splitMatch = await findSplitMatches(subcategoryIds, preferred_time, dayOfWeek, pool);
}

    const sortedPerfectMatch = sortMatches(perfectMatch, sortBy, order);
    const sortedPartialMatch = sortMatches(partialMatch, sortBy, order);
    console.log('Partial matches:', partialMatch);
    console.log('Split matches:', splitMatch);

    return res.status(200).json({
      perfectMatch: sortedPerfectMatch,
      partialMatch: sortedPartialMatch,
      splitMatch
    });
    
  } catch (err) {
    console.error('❌ Error searching for workshops:', err);
    return res.status(500).json({ message: 'Server error 😩' });
  }
});


router.get('/subcategories/search', async (req, res) => {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).json({ message: 'Keyword is required' });
  }

  try {
    const query = `
      SELECT *
      FROM SubCategories
      WHERE 
        similarity(LOWER(subcategory_name), LOWER($1)) > 0.3
      ORDER BY
        GREATEST(
          similarity(LOWER(subcategory_name), LOWER($1))
        ) DESC;
    `;

    const result = await pool.query(query, [keyword]);

    return res.status(200).json({
      message: result.rows.length === 0 ? 'No matches found' : 'Search successful',
      subcategories: result.rows,
    });
  } catch (error) {
    console.error('Error searching subcategories:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/searchhome', async (req, res) => {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).json({ message: 'Keyword is required' });
  }

  try {
const combinedQuery = `
  SELECT * FROM (
  SELECT 
    'subcategory' AS type,
    subcategory_id AS id,
    subcategory_name AS name,
    NULL AS image,
    NULL AS street,
    NULL AS city,
    NULL::float AS rate,
    NULL::boolean AS emergency_service,
    NULL::boolean AS mobile_assistance,
    NULL::int AS number_of_services,
    NULL::text AS services_list,
    NULL::int AS day_of_week,
    NULL::time AS start_time,
    NULL::time AS end_time,
    similarity(LOWER(subcategory_name), LOWER($1)) AS sim
  FROM SubCategories
  WHERE similarity(LOWER(subcategory_name), LOWER($1)) > 0.3

  UNION ALL

 SELECT 
  'workshop' AS type,
  w.workshop_id AS id,
  w.workshop_name AS name,
  u.profile_picture AS image,
  a.street,
  a.city,
  w.rate,
  w.emergency_service,
  w.mobile_assistance,
  COUNT(DISTINCT s.service_id) AS number_of_services,
  STRING_AGG(DISTINCT s.service_name, ', ') AS services_list,
  MAX(wwh.day_of_week) AS day_of_week,
  MAX(wwh.start_time) AS start_time,
  MAX(wwh.end_time) AS end_time,
  NULL::float AS sim
FROM Workshops w
LEFT JOIN Address a ON w.address_id = a.address_id
LEFT JOIN Service s ON s.workshop_id = w.workshop_id
LEFT JOIN WorkshopWorkingHours wwh ON wwh.workshop_id = w.workshop_id
LEFT JOIN Users u ON w.user_id = u.user_id
WHERE w.workshop_name ILIKE '%' || $1 || '%'
GROUP BY 
  w.workshop_id, w.workshop_name, u.profile_picture, a.street, a.city, w.rate, w.emergency_service, w.mobile_assistance

) AS combined_results
ORDER BY sim DESC NULLS LAST;
`;

    const result = await pool.query(combinedQuery, [keyword]);
    console.log('Search results1:', result.rows);
    return res.status(200).json({
      message: result.rows.length === 0 ? 'No matches found' : 'Search successful',
      results: result.rows,
    });
  } catch (error) {
    console.error('Error searching:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});


router.get('/workshops/search', async (req, res) => {
  const { subcategoryIds } = req.query;

  if (!subcategoryIds) {
    return res.status(400).json({ message: 'Missing required query parameter: subcategoryIds' });
  }

  try {
    const query = `
   SELECT 
  w.workshop_id,
  w.workshop_name,
  w.rate,
  w.working_day_hours,
  a.street,
  a.city,
  u.profile_picture,
  w.emergency_service,
  w.mobile_assistance,
  w.pickup_fee,
  w.pickup_service_available,
  COALESCE(
    JSON_AGG(
      JSON_BUILD_OBJECT(
        'service_id', s.service_id,
        'price', s.price,
        'service_name', s.service_name,
        'estimated_duration', s.estimated_duration,
        'is_mobile', s.is_mobile,
        'mobile_fee', s.mobile_fee
      )
    ) FILTER (WHERE s.service_id IS NOT NULL),
    '[]'
  ) AS services
FROM Workshops w
JOIN Address a ON w.address_id = a.address_id
LEFT JOIN Service s ON w.workshop_id = s.workshop_id AND s.subcategory_id = ANY($1::int[])
LEFT JOIN Users u ON w.user_id = u.user_id
WHERE w.approval_status = 'Approved'
  AND EXISTS (
    SELECT 1 FROM Service s2
    WHERE s2.workshop_id = w.workshop_id
      AND s2.subcategory_id = ANY($1::int[])
  )
GROUP BY w.workshop_id, a.street, a.city, u.profile_picture;


    `;

    const values = [subcategoryIds.split(',').map(Number)];

    const result = await pool.query(query, values);
    return res.json({ workshops: result.rows });

  } catch (error) {
    console.error('Error fetching workshops:', error);
    return res.status(500).json({ message: 'Server error' });
  }

});



module.exports = router;
