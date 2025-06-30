var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const fbCapiRouter = require('./routes/fb-capi');
const pixelRouter = require('./routes/pixel');

var app = express();

const allowedOrigins = [
  'https://seu-frontend.vercel.app', // produção (ajuste para o domínio real do seu frontend)
  'http://localhost:5173'            // desenvolvimento local
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
app.use('/pixel', pixelRouter);

module.exports = app;
