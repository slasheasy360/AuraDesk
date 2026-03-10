import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    let token = null;

    if (header && header.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    } else if (req.query.token) {
      // Allow token via query param for inline media preview (images, videos)
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
