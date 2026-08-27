require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const productRoutes = require('./routes/products');
const posRoutes = require('./routes/pos');
const customerRoutes = require('./routes/customers');
const cashSessionRoutes = require('./routes/cashSessions');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const { requireLogin } = require('./middleware/auth');
const { money, qty } = require('./utils/format');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    store: new pgSession({
      conString: process.env.DATABASE_URL,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 12 * 60 * 60 * 1000, // 12 saat
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  res.locals.money = money;
  res.locals.qty = qty;
  next();
});

app.use('/', authRoutes);
app.use('/', requireLogin, dashboardRoutes);
app.use('/products', requireLogin, productRoutes);
app.use('/pos', requireLogin, posRoutes);
app.use('/customers', requireLogin, customerRoutes);
app.use('/cash-sessions', requireLogin, cashSessionRoutes);
app.use('/reports', requireLogin, reportRoutes);
app.use('/users', requireLogin, userRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Tapılmadı', message: 'Bu səhifə mövcud deyil.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Xəta', message: err.message || 'Daxili server xətası.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mağaza POS sistemi ${PORT} portunda işləyir.`);
});
