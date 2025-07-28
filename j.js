WHERE
b.workshop_id = $1
        AND b.booking_status = 'pending'
AND(b.scheduled_date >= CURRENT_DATE
 OR(b.scheduled_date = CURRENT_DATE AND b.scheduled_time > CURRENT_TIME))