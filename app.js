var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const fbCapiRouter = require('./routes/fb-capi');
const pixelRouter = require('./routes/pixel');

// =========================
// Rotas da API
// =========================
const authRoutes = require('./routes/auth');
const pixelRoutes = require('./routes/pixels');
const workspaceRoutes = require('./routes/workspaces');
const eventRoutes = require('./routes/events');
const conversionRoutes = require('./routes/conversions');
const capiRoutes = require('./routes/capi');
const alertRoutes = require('./routes/alerts');
const logRoutes = require('./routes/logs');
const integrationRoutes = require('./routes/integrations');

var app = express();

const allowedOrigins = [
  'https://instituto-viva.vercel.app', // produção
  'http://localhost:5173'              // desenvolvimento local
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/fb-capi', fbCapiRouter);
// app.use('/pixel', pixelRouter); // Removido para evitar conflito e problemas de CORS

// Prefixo /api para todas as rotas
app.use('/api/auth', authRoutes);
app.use('/api/pixels', pixelRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/conversions', conversionRoutes);
app.use('/api/capi', capiRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/integrations', integrationRoutes);

module.exports = app;
