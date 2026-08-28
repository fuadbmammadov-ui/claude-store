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
const supplierRoutes = require('./routes/suppliers');
const expenseRoutes = require('./routes/expenses');
const { requireLogin } = require('./middleware/auth');
const { money, qty } = require('./utils/format');

const app = express();

const ASSET_VERSION = process.env.RENDER_GIT_COMMIT || Date.now().toString();

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
  res.locals.assetVersion = ASSET_VERSION;
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
app.use('/suppliers', requireLogin, supplierRoutes);
app.use('/expenses', requireLogin, expenseRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Tapılmadı', message: 'Bu səhifə mövcud deyil.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Xəta', message: err.message || 'Daxili server xətası.' });
});

function runStartupScript(scriptPath) {
  const { execSync } = require('child_process');
  try {
    execSync(`node ${scriptPath}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err) {
    console.error(`${scriptPath} işə salınarkən xəta baş verdi:`, err.message);
  }
}

// Render-in build əmri konfiqurasiyası dəyişəndə "yadda saxlana" bilir və render.yaml-dakı
// yeniləmələri avtomatik götürmür — ona görə seed/idxal skriptlərini burada, server açılan
// zaman da işə salırıq. Hər ikisi idempotentdir (artıq işlənibsə heç nə etmir).
runStartupScript('prisma/seed.js');
runStartupScript('prisma/import-legacy.js');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mağaza POS sistemi ${PORT} portunda işləyir.`);
});
