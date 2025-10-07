import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { sseHandler } from './sse.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'change-me',
  resave: false,
  saveUninitialized: false,
}));

// API
app.get('/api/events', sseHandler);
app.use('/api', routes);

// Static frontend
app.use('/', express.static(path.join(__dirname, '..', 'web')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ticket system running on http://localhost:${PORT}`));
