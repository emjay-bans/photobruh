const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const Database = require('better-sqlite3');

require('dotenv').config();

const db = new Database('database.sqlite');
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (your frontend) from the root
app.use(express.static(__dirname));

// Serve uploaded photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- Authentication endpoints ----------

// Signup
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Invalid email or password (min 6 chars)' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  const userId = result.lastInsertRowid;

  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// ---------- Middleware to protect routes ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- Photo endpoints ----------

// Upload
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, filename);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.post('/api/photos', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  db.prepare('INSERT INTO photos (user_id, filename) VALUES (?, ?)')
    .run(req.userId, req.file.filename);

  res.json({ url: `/uploads/${req.file.filename}` });
});

// List all photos for logged-in user
app.get('/api/photos', authMiddleware, (req, res) => {
  const photos = db.prepare('SELECT id, filename, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId)
    .map(p => ({ ...p, url: `/uploads/${p.filename}` }));
  res.json(photos);
});

// Delete a photo
app.delete('/api/photos/:id', authMiddleware, (req, res) => {
  const photo = db.prepare('SELECT filename FROM photos WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  // Remove file
  const filePath = path.join(__dirname, 'uploads', photo.filename);
  try { require('fs').unlinkSync(filePath); } catch (e) {}

  db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  res.json({ success: true });
});

// ---------- Start ----------
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));