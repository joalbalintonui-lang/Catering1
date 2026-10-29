const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const conn = require('./conn.js');
const app = express();

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Configure Express Session
app.use(session({
    secret: 'catering_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Set View Engine
app.set('view engine', 'ejs');

// Authentication Guard Middleware
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
};

// Admin Guard Middleware
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send("Access Denied: Admin privileges required.");
};

// Helper: Calculate total price based on package and guest count
const calculateTotalPrice = (packageType, guestCount) => {
    const rates = {
        'Standard': 300,
        'Deluxe': 500,
        'Premium': 800
    };
    const rate = rates[packageType] || 300;
    return rate * parseInt(guestCount || 0, 10);
};

// ================= PUBLIC ROUTES =================

// Public Landing Page (Renders index.ejs)
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user || null });
});

// ================= AUTH ROUTES =================

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    const { user_name, user_email, user_password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(user_password, 10);
        const insertUser = `INSERT INTO users (user_name, user_email, user_password, role) VALUES (?, ?, ?, 'client')`;

        conn.query(insertUser, [user_name, user_email, hashedPassword], (err) => {
            if (err) {
                return res.send(`<script>alert('Email already registered or DB Error!'); location.href='/register';</script>`);
            }
            res.send(`<script>alert('Account created! Please login.'); location.href='/login';</script>`);
        });
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { user_email, user_password } = req.body;
    const findUser = `SELECT * FROM users WHERE user_email = ?`;

    conn.query(findUser, [user_email], async (err, results) => {
        if (err || results.length === 0) {
            return res.send(`<script>alert('User not found!'); location.href='/login';</script>`);
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(user_password, user.user_password);

        if (isMatch) {
            req.session.user = user;
            if (user.role === 'admin') {
                res.redirect('/admin');
            } else {
                res.redirect('/');
            }
        } else {
            res.send(`<script>alert('Incorrect Password!'); location.href='/login';</script>`);
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ================= CLIENT DASHBOARD & BOOKING =================

// Logged-in User Dashboard (Renders homepage.ejs)
app.get('/dashboard', isAuthenticated, (req, res) => {
    const user_id = req.session.user.user_id;
    const getBookings = `SELECT * FROM tbl_bookings WHERE user_id = ? ORDER BY id DESC LIMIT 5`;

    conn.query(getBookings, [user_id], (err, bookings) => {
        if (err) throw err;
        res.render('homepage', { user: req.session.user, recentBookings: bookings });
    });
});

app.post('/book', isAuthenticated, (req, res) => {
    const { customer_name, event_date, package_type, guest_count, address } = req.body;
    const user_id = req.session.user.user_id;

    const totalPrice = calculateTotalPrice(package_type, guest_count);

    const insertBooking = `INSERT INTO tbl_bookings (user_id, customer_name, event_date, package_type, guest_count, address, total_price, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`;

    conn.query(insertBooking, [user_id, customer_name, event_date, package_type, guest_count, address, totalPrice], (err, result) => {
        if (err) throw err;
        const bookingId = result.insertId;
        res.redirect(`/select-food/${bookingId}`);
    });
});

// ================= MENU SELECTION ROUTES =================

app.get('/select-food/:id', isAuthenticated, (req, res) => {
    const bookingId = req.params.id;
    const userId = req.session.user.user_id;

    const getBooking = `SELECT * FROM tbl_bookings WHERE id = ? ${req.session.user.role === 'admin' ? '' : 'AND user_id = ?'}`;
    const queryParams = req.session.user.role === 'admin' ? [bookingId] : [bookingId, userId];

    conn.query(getBooking, queryParams, (err, results) => {
        if (err || results.length === 0) {
            return res.send(`<script>alert('Booking not found!'); location.href='/view';</script>`);
        }
        res.render('select-food', { booking: results[0] });
    });
});

app.post('/save-food', isAuthenticated, (req, res) => {
    const { booking_id, food_items } = req.body;
    const userId = req.session.user.user_id;

    const selectedFoodString = Array.isArray(food_items) ? food_items.join(', ') : (food_items || 'Standard Menu');

    const updateFood = `UPDATE tbl_bookings SET selected_food = ? WHERE id = ? ${req.session.user.role === 'admin' ? '' : 'AND user_id = ?'}`;
    const queryParams = req.session.user.role === 'admin' ? [selectedFoodString, booking_id] : [selectedFoodString, booking_id, userId];

    conn.query(updateFood, queryParams, (err) => {
        if (err) throw err;
        res.redirect(`/checkout/${booking_id}`);
    });
});

// ================= PAYMENT ROUTES =================

app.get('/checkout/:id', isAuthenticated, (req, res) => {
    const bookingId = req.params.id;
    const userId = req.session.user.user_id;

    const getBooking = `SELECT * FROM tbl_bookings WHERE id = ? ${req.session.user.role === 'admin' ? '' : 'AND user_id = ?'}`;
    const queryParams = req.session.user.role === 'admin' ? [bookingId] : [bookingId, userId];

    conn.query(getBooking, queryParams, (err, results) => {
        if (err || results.length === 0) {
            return res.send(`<script>alert('Booking not found!'); location.href='/view';</script>`);
        }
        res.render('checkout', { booking: results[0] });
    });
});

app.post('/process-payment', isAuthenticated, (req, res) => {
    const { booking_id, payment_method } = req.body;
    const userId = req.session.user.user_id;

    const paymentStatus = payment_method === 'Cash on Event' ? 'Pending (Cash)' : 'Paid';

    const updatePayment = `UPDATE tbl_bookings SET payment_method = ?, payment_status = ? WHERE id = ? ${req.session.user.role === 'admin' ? '' : 'AND user_id = ?'}`;
    const queryParams = req.session.user.role === 'admin' ? [payment_method, paymentStatus, booking_id] : [payment_method, paymentStatus, booking_id, userId];

    conn.query(updatePayment, queryParams, (err) => {
        if (err) throw err;
        res.send(`<script>alert('Payment confirmed! Reservation finalized.'); location.href='/view';</script>`);
    });
});

// ================= OTHER ROUTES =================

app.get('/view', isAuthenticated, (req, res) => {
    const user_id = req.session.user.user_id;
    const getBookings = `SELECT * FROM tbl_bookings WHERE user_id = ?`;

    conn.query(getBookings, [user_id], (err, data) => {
        if (err) throw err;
        res.render('view', { bookings: data, user: req.session.user });
    });
});

app.get('/delete/:id', isAuthenticated, (req, res) => {
    const del_id = req.params.id;
    const user_id = req.session.user.user_id;

    let deleteSql = `DELETE FROM tbl_bookings WHERE id = ? AND user_id = ?`;
    let queryParams = [del_id, user_id];

    if (req.session.user.role === 'admin') {
        deleteSql = `DELETE FROM tbl_bookings WHERE id = ?`;
        queryParams = [del_id];
    }

    conn.query(deleteSql, queryParams, (err) => {
        if (err) throw err;
        const redirectUrl = req.session.user.role === 'admin' ? '/admin' : '/view';
        res.send(`<script>alert('Booking Cancelled!'); location.href='${redirectUrl}';</script>`);
    });
});

app.get('/change-password', isAuthenticated, (req, res) => {
    res.render('change-password', { user: req.session.user });
});

app.post('/change-password', isAuthenticated, async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const user_id = req.session.user.user_id;

    if (new_password !== confirm_password) {
        return res.send(`<script>alert('New passwords do not match!'); location.href='/change-password';</script>`);
    }

    try {
        const getUser = `SELECT user_password FROM users WHERE user_id = ?`;

        conn.query(getUser, [user_id], async (err, results) => {
            if (err || results.length === 0) {
                return res.send(`<script>alert('Error fetching user data.'); location.href='/change-password';</script>`);
            }

            const currentHashedPassword = results[0].user_password;
            const isMatch = await bcrypt.compare(current_password, currentHashedPassword);

            if (!isMatch) {
                return res.send(`<script>alert('Incorrect current password!'); location.href='/change-password';</script>`);
            }

            const newHashedPassword = await bcrypt.hash(new_password, 10);
            const updateSql = `UPDATE users SET user_password = ? WHERE user_id = ?`;

            conn.query(updateSql, [newHashedPassword, user_id], (err) => {
                if (err) throw err;
                res.send(`<script>alert('Password updated successfully!'); location.href='/dashboard';</script>`);
            });
        });
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

// Admin Panel Route
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    const getAllBookings = `SELECT * FROM tbl_bookings ORDER BY id DESC`;
    conn.query(getAllBookings, (err, bookings) => {
        if (err) throw err;
        res.render('admin/dashboard', { user: req.session.user, bookings });
    });
});

app.listen(8000, () => {
    console.log('Server running on http://localhost:8000');
});