import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import mysql from 'mysql2/promise';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();

const port = process.env.PORT || 3000;
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: Number(process.env.MAX_FILE_MB || 50) * 1024 * 1024 },
});

const db = await mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'music',
});

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

app.post('/api/tracks', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { title = req.file.originalname, artist = '', album = '' } = req.body;
    const filePath = req.file.path;
    const [result] = await db.execute(
      'INSERT INTO tracks (title, artist, album, file_path) VALUES (?,?,?,?)',
      [title, artist, album, filePath],
    );
    res.json({ id: result.insertId, title, artist, album, filePath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/tracks', async (_req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, artist, album, cover_url, duration_seconds FROM tracks ORDER BY created_at DESC',
  );
  res.json(rows);
});

app.get('/api/tracks/:id/stream', async (req, res) => {
  const [rows] = await db.execute('SELECT file_path FROM tracks WHERE id=?', [req.params.id]);
  if (!rows.length) return res.sendStatus(404);
  res.sendFile(path.resolve(rows[0].file_path));
});

app.post('/api/playlists', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const [r] = await db.execute('INSERT INTO playlists (name) VALUES (?)', [name]);
  res.json({ id: r.insertId, name });
});

app.get('/api/playlists', async (_req, res) => {
  const [rows] = await db.execute('SELECT id, name FROM playlists ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/playlists/:id/tracks', async (req, res) => {
  const { trackId, position = 0 } = req.body;
  if (!trackId) return res.status(400).json({ error: 'trackId required' });
  await db.execute(
    'INSERT IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)',
    [req.params.id, trackId, position],
  );
  res.json({ ok: true });
});

app.get('/api/playlist-tracks', async (_req, res) => {
  const [rows] = await db.execute('SELECT playlist_id, track_id FROM playlist_tracks');
  res.json(rows);
});

app.delete('/api/playlists/:id', async (req, res) => {
  await db.execute('DELETE FROM playlists WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/playlists/:pid/tracks/:tid', async (req, res) => {
  await db.execute(
    'DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?',
    [req.params.pid, req.params.tid],
  );
  res.json({ ok: true });
});

app.delete('/api/tracks/:id', async (req, res) => {
  const trackId = req.params.id;
  const [rows] = await db.execute('SELECT file_path FROM tracks WHERE id=?', [trackId]);
  if (!rows.length) return res.sendStatus(404);
  await db.execute('DELETE FROM tracks WHERE id=?', [trackId]);
  const filePath = rows[0].file_path;
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.warn('Failed to delete file', err.message);
    }
  }
  res.json({ ok: true });
});

app.use('/uploads', express.static(uploadDir));

app.listen(port, () => {
  console.log(`API ready at http://localhost:${port}`);
});
