const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const Database = require('better-sqlite3');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const streamifier = require('streamifier');
const fs = require('fs');    // still needed for creating the data directory maybe

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

require('dotenv').config();

const db = new Database('database.sqlite');
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = 3000;

// Ensure the photos table has the needed columns
db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT,
    public_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// If the table already existed but without the new columns, add them
try { db.exec(`ALTER TABLE photos ADD COLUMN url TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE photos ADD COLUMN public_id TEXT`); } catch (e) {}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (your frontend) from the root
app.use(express.static(__dirname));

// Serve uploaded photos

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
// Multer memory storage – we'll upload the buffer to Cloudinary manually
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.post('/api/photos', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  // Upload buffer to Cloudinary
  const uploadStream = cloudinary.uploader.upload_stream(
    { folder: 'photobruh' },   // optional folder in Cloudinary
    (error, result) => {
      if (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({ error: 'Upload failed' });
      }

      // result contains secure_url and public_id
      const { secure_url, public_id } = result;

      // Save to database
      db.prepare('INSERT INTO photos (user_id, url, public_id) VALUES (?, ?, ?)')
        .run(req.userId, secure_url, public_id);

      res.json({ url: secure_url, public_id });
    }
  );

  // Pipe the buffer into the upload stream
  streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
});

// List all photos for logged-in user
app.get('/api/photos', authMiddleware, (req, res) => {
  const photos = db.prepare('SELECT id, url, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId);
  res.json(photos);
});

// Delete a photo
app.delete('/api/photos/:id', authMiddleware, (req, res) => {
  const photo = db.prepare('SELECT public_id FROM photos WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  // Delete from Cloudinary
  cloudinary.uploader.destroy(photo.public_id, (error, result) => {
    if (error) console.error('Cloudinary delete error:', error);
    // Continue even if deletion fails (maybe already deleted)
  });

  // Delete from database
  db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  res.json({ success: true });
});

// ---------- Start ----------
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));