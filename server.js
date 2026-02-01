import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

import passport from 'passport';
import authRoutes, { initPassport } from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import messageRoutes from './routes/messages.js';
import { authenticateToken } from './middleware/auth.js';
import Project from './models/Project.js';
import User from './models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || getExtensionFromMimetype(file.mimetype);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

function getExtensionFromMimetype(mimetype) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return map[mimetype] || '.bin';
}

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, MP4, WebM'));
    }
  },
});

initPassport();
const frontendUrl = process.env.FRONTEND_URL;
app.use(
  cors({
    origin: frontendUrl ? frontendUrl.split(',').map((u) => u.trim()).filter(Boolean) : true,
    credentials: true,
  })
);
app.use(express.json());
app.use(passport.initialize());

// Serve uploaded media files
app.use('/api/media', express.static(UPLOADS_DIR));

// Auth routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

// Get all projects (public - no auth required)
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find()
      .sort({ order: 1, createdAt: -1 })
      .populate('userId', 'name username profilePhoto')
      .lean();
    const formatted = projects.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      description: p.description,
      media: p.media,
      order: p.order,
      createdAt: p.createdAt,
      liveDemoUrl: p.liveDemoUrl || '',
      codeUrl: p.codeUrl || '',
      likeCount: p.likes?.length || 0,
      commentCount: p.comments?.length || 0,
      comments: p.comments || [],
      likes: p.likes?.map((id) => id.toString()) || [],
      savedBy: p.savedBy?.map((id) => id.toString()) || [],
      user: p.userId
        ? { id: p.userId._id.toString(), name: p.userId.name, username: p.userId.username, profilePhoto: p.userId.profilePhoto }
        : null,
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project (public)
app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('userId', 'name username profilePhoto')
      .lean();
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({
      id: project._id.toString(),
      ...project,
      likeCount: project.likes?.length || 0,
      commentCount: project.comments?.length || 0,
      user: project.userId
        ? { id: project.userId._id.toString(), name: project.userId.name, username: project.userId.username, profilePhoto: project.userId.profilePhoto }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Add new project (requires authentication) - must be before projectRoutes
app.post('/api/projects', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const { title, description, liveDemoUrl, codeUrl } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Media file is required' });
    }

    const count = await Project.countDocuments();
    const mediaUrl = `/api/media/${req.file.filename}`;

    const project = await Project.create({
      title: title.trim(),
      description: description.trim(),
      media: [{ url: mediaUrl, filename: req.file.filename }],
      order: count,
      userId: req.user._id,
      liveDemoUrl: liveDemoUrl?.trim() || '',
      codeUrl: codeUrl?.trim() || '',
    });

    res.status(201).json({
      id: project._id.toString(),
      title: project.title,
      description: project.description,
      media: project.media,
      order: project.order,
      liveDemoUrl: project.liveDemoUrl,
      codeUrl: project.codeUrl,
      createdAt: project.createdAt,
    });
  } catch (err) {
    console.error('Error adding project:', err);
    res.status(500).json({ error: err.message || 'Failed to add project' });
  }
});

// Project interactions (like, comment, save)
app.use('/api/projects', projectRoutes);

app.listen(PORT, () => {
  console.log(`Project Gallery API running at http://localhost:${PORT}`);
});
