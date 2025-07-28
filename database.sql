CREATE DATABASE VehilceMaintenance;


CREATE TABLE Users (
    user_id SERIAL PRIMARY KEY,  -- SERIAL automatically handles auto-increment
    profile_picture VARCHAR(255),
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email_address VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Customer', 'Admin', 'Mechanic')),  -- ENUM equivalent
    phone_number VARCHAR(15) UNIQUE
);

CREATE TABLE Customers (
    customer_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    loyalty_points INT DEFAULT 0,
    cancel_count INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);
CREATE TABLE CustomerWallet (
  wallet_id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL,
  balance NUMERIC(10, 2) DEFAULT 0, -- رصيد المحفظة
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)
);
CREATE TABLE WalletTransactions (
  transaction_id SERIAL PRIMARY KEY,
  wallet_id INT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL, -- المبلغ المدفوع أو المسترجع (سالب أو موجب)
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('refund', 'prepayment', 'payment', 'adjustment')),
  related_booking_id INT, -- لو مرتبط بحجز معين
  transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES CustomerWallet(wallet_id),
  FOREIGN KEY (related_booking_id) REFERENCES Booking(booking_id)
);

CREATE TABLE Admins (
    admin_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    permission_level INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

CREATE TABLE Workshops (
    workshop_id SERIAL PRIMARY KEY,
    workshop_name VARCHAR(100) NOT NULL,
    image VARCHAR(255),
    rate DOUBLE PRECISION NOT NULL,  
    capacity INT NOT NULL,
    working_day_hours VARCHAR(50),
    emergency_service BOOLEAN DEFAULT FALSE,
    mobile_assistance BOOLEAN DEFAULT FALSE,
    pickup_service_available BOOLEAN DEFAULT FALSE, 
    pickup_fee DOUBLE PRECISION DEFAULT 0,          
    current_occupancy INT DEFAULT 0,
    address_id INT NOT NULL,
    approval_status VARCHAR(20) DEFAULT 'Pending',
    user_id INT UNIQUE NOT NULL,
    reliability_score INT DEFAULT 100,  
    FOREIGN KEY (address_id) REFERENCES Address(address_id),
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);



CREATE TABLE WorkshopWorkingHours (
  id SERIAL PRIMARY KEY,
  workshop_id INT NOT NULL,
  day_of_week INT NOT NULL,  -- 0: Sunday ... 6: Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)
);
CREATE TABLE Address (
    address_id SERIAL PRIMARY KEY,
    street VARCHAR(255) NOT NULL,
    city VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    
     DOUBLE PRECISION NOT NULL,
    user_id INT UNIQUE,  -- Ensures only one address per user
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE  -- Cascade delete if user is deleted
);

CREATE TABLE Booking (
    booking_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    workshop_id INT NOT NULL,           
    status_name VARCHAR(50) NOT NULL CHECK ( status_name IN ('not started', 'in progress', 'complete')),    -- لو تستخدم status_id بدلاً من الاسم، عدل هنا
    booking_date DATE NOT NULL,
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,        
    completion_date DATE,
CHECK (booking_status IN (
  'pending', 
  'accepted',
  'accepted partially paid',
  'rejected', 
  'complete paid', 
  'complete unpaid', 
  'complete partially paid',
  'canceled'
));
ADD COLUMN is_mobile_service BOOLEAN DEFAULT FALSE,
ADD COLUMN cancellation_by VARCHAR(20) CHECK (cancellation_by IN ('user', 'workshop')),
ADD COLUMN cancelled_at TIMESTAMP,
ADD COLUMN cancellation_reason TEXT;

    payment_id INT,
    address_id INT,
    temporary_street VARCHAR(255),ALTER TABLE Booking
ADD COLUMN refund_issued BOOLEAN DEFAULT FALSE,
ADD COLUMN refund_amount INT DEFAULT 0,
ADD COLUMN admin_approval VARCHAR(20) CHECK (admin_approval IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
ADD COLUMN admin_comment TEXT;

    temporary_city VARCHAR(50),
    vehicle_id INT NOT NULL,
     amount_paid INT DEFAULT 0;
  is_pickup BOOLEAN DEFAULT FALSE,
    pickup_status VARCHAR(20) CHECK (
        pickup_status IN ('pending', 'on the way', 'received', 'completed', 'cancelled')
    ),

    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (address_id) REFERENCES Address(address_id),
    FOREIGN KEY (service_id) REFERENCES Service(service_id),
    FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)
);



CREATE TABLE WorkshopAvailabilityExceptions (
  id SERIAL PRIMARY KEY,
  workshop_id INT NOT NULL,
  date DATE NOT NULL,
  time_start TIME,
  time_end TIME,
  status VARCHAR(20) NOT NULL CHECK (status IN ('closed', 'unavailable')),
  FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)
);


CREATE TABLE Service (
    service_id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    service_description TEXT,
    category_id INT NOT NULL,
    price INT NOT NULL,
    subcategory_id INT,  -- Linking service to a specific subcategory
    FOREIGN KEY (subcategory_id) REFERENCES SubCategories(subcategory_id),
    workshop_id INT,  -- Linking service to a specific workshop
    FOREIGN KEY (category_id) REFERENCES ServiceCategories(category_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)  -- Each service belongs to a workshop
    estimated_duration INT NOT NULL,
   is_mobile BOOLEAN DEFAULT FALSE,
mobile_fee INT DEFAULT 0
);

CREATE TABLE ServiceCategories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL
);
CREATE TABLE SubCategories (
    subcategory_id SERIAL PRIMARY KEY,
    subcategory_name VARCHAR(100) NOT NULL,
    price INT NOT NULL,
    category_id INT REFERENCES ServiceCategories(category_id)
);

CREATE TABLE Payment (
    payment_id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL,
    income_value INT NOT NULL,
    percent_to_admin DOUBLE PRECISION NOT NULL,
    percent_to_workshop DOUBLE PRECISION NOT NULL,
    date DATE NOT NULL,
    type VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50) NOT NULL,  -- 'partial' أو 'final' أو 
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
);

CREATE TABLE Review (
    review_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,  -- لازم يكون موجود عشان تعرف مين عمل التقييم
    target VARCHAR(50) NOT NULL,  -- ممكن تكون 'Workshop' أو 'Service'
    target_id INT NOT NULL,  -- id للورشة أو الخدمة حسب الهدف
    service_id INT,  -- هنا تحط معرف الخدمة إذا التقييم للخدمة مش للورشة
    workshop_id INT,  -- تحطها كمان للربط مع الورشة
    rating DOUBLE PRECISION NOT NULL,
    comment TEXT,
    review_date DATE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (service_id) REFERENCES Service(service_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)
);


CREATE TABLE Offer (
    offer_id SERIAL PRIMARY KEY,
    description TEXT,
    service_category_id INT,
    duration INT,
    discount_percentage DOUBLE PRECISION,
    target_type VARCHAR(50) NOT NULL, -- 'all', 'customer', 'workshop', 'category' مثلاً
    target_id INT, -- ممكن يكون NULL لو target_type = 'all'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_price DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE Vehicle (
    vehicle_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    reference_id INT NOT NULL,
    isDefault BOOLEAN DEFAULT FALSE,
    registration_date DATE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (reference_id) REFERENCES ReferenceVehicle(reference_id)
); 
CREATE TABLE Garage (
    garage_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id),
    CONSTRAINT UNIQUE (user_id, vehicle_id)  -- Ensuring uniqueness of each vehicle for a user
);
CREATE TABLE MaintenanceLog (
    log_id SERIAL PRIMARY KEY,
    vehicle_id INT NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);

CREATE TABLE Notification (
    notification_id SERIAL PRIMARY KEY,
    sender_user_id INT NOT NULL,
    receiver_user_id INT NOT NULL, 
    message TEXT NOT NULL,
    date DATE NOT NULL,
    notification_type VARCHAR(50),  -- Added type for categorizing notifications
    target_group VARCHAR(50), 
    is_read boolean ,
    FOREIGN KEY (sender_user_id) REFERENCES Users(user_id),
    FOREIGN KEY (receiver_user_id) REFERENCES Users(user_id)
);


-- CREATE TABLE EmergencyService (
--     emergency_service_id INT PRIMARY KEY AUTO_INCREMENT,
--     service_id INT NOT NULL,  -- Foreign key to the Service table
--     priority_level INT NOT NULL,  -- Priority level of the emergency service
--     availability VARCHAR(50),  -- Availability information like "24/7", "Weekdays Only"
--     additional_cost DOUBLE NOT NULL,  -- Extra cost for emergency service
--     FOREIGN KEY (service_id) REFERENCES Service(service_id)
-- );



CREATE TABLE ReferenceVehicle ( --redy for the customer to select from
    reference_id SERIAL PRIMARY KEY,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    transmission VARCHAR(50),
    engine_size DOUBLE PRECISION NOT NULL,
    fuel_type VARCHAR(50)
    ALTER TABLE Review ADD COLUMN user_id INT REFERENCES Users(user_id);

);
CREATE TABLE Certifications (
    certification_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    issuing_authority VARCHAR(100),
    valid_until DATE,
    workshop_id INT
        FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id),

);

Specializations (
  specialization_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
)

CREATE TABLE BookingService (
    id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL,
    service_id INT NOT NULL,
    status VARCHAR(50) CHECK (status IN ('requested', 'approved', 'rejected', 'completed')) DEFAULT 'requested',
    added_by VARCHAR(20) CHECK (added_by IN ('user', 'mechanic')) DEFAULT 'user',
    approved_by_user BOOLEAN DEFAULT TRUE,
    price INT,
    estimated_duration INT,
    
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES Service(service_id)
);

CREATE TABLE BookingReport (
    report_id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL,
    report_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT,  -- user_id أو الميكانيكي
    ALTER TABLE BookingReport
    total_amount INT,  -- مجموع الفاتورة النهائي
    services JSONB;    -- كل الخدمات بصيغة JSON
   approved_by_user BOOLEAN DEFAULT FALSE

    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
);

CREATE TABLE EmergencyService (
    emergency_service_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- مثل Mechanical, Electrical, Tire, Repair
    is_active BOOLEAN DEFAULT TRUE
);
CREATE TABLE WorkshopEmergencyService (
    id SERIAL PRIMARY KEY,
    workshop_id INT NOT NULL,
    emergency_service_id INT NOT NULL,
    price INT NOT NULL, -- السعر بالشيكل أو اللي بدك
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id),
    FOREIGN KEY (emergency_service_id) REFERENCES EmergencyService(emergency_service_id),
    UNIQUE (workshop_id, emergency_service_id) -- حتى ما تتكرر نفس الخدمة عند نفس الورشة
);

CREATE TABLE EmergencyBooking (
    emergency_booking_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    emergency_service_id INT NOT NULL,  -- أضفت هذا الحقل
    requested_datetime TIMESTAMP NOT NULL,
    status VARCHAR(30) DEFAULT 'Waiting', -- Waiting, Confirmed, Cancelled, Expired
    confirmed_workshop_id INT, -- لما وحدة توافق
    price INT,                -- السعر النهائي المتفق عليه
    user_address TEXT,          -- حقل العنوان هنا
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
    FOREIGN KEY (vehicle_id) REFERENCES Vehicles(vehicle_id),
    FOREIGN KEY (emergency_service_id) REFERENCES EmergencyService(emergency_service_id),
    FOREIGN KEY (confirmed_workshop_id) REFERENCES Workshops(workshop_id)
);

CREATE TABLE EmergencyBookingRequest (
    emergency_request_id SERIAL PRIMARY KEY,
    emergency_booking_id INT NOT NULL,
    workshop_id INT NOT NULL,

    status VARCHAR(20) DEFAULT 'Pending', 
    -- Pending, Accepted, Rejected, Timeout, Skipped

    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    response_time TIMESTAMP,

    reminder_sent BOOLEAN DEFAULT FALSE,

    FOREIGN KEY (emergency_booking_id) REFERENCES EmergencyBooking(emergency_booking_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id),
    UNIQUE (emergency_booking_id, workshop_id)
);
