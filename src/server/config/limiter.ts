import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

// Standard IP-based key generator to bypass the express-rate-limit ERR_ERL_FORWARDED_HEADER warning
// since we rely on Express's trust proxy (which uses X-Forwarded-For) rather than the Forwarded header.
const standardKeyGenerator = (req: Request) => ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown');

export const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: standardKeyGenerator,
  message: { error: 'Rất tiếc! Hệ thống phân tích AI đang nhận quá nhiều yêu cầu đồng thời. Vui lòng thử lại sau vài giây.' },
});

export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: standardKeyGenerator,
  message: { success: false, error: 'Quá nhiều lần thử đăng nhập thất bại. Vui lòng khóa tạm thời 15 phút.' },
});

export const adminDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: standardKeyGenerator,
  message: { success: false, error: 'Vui lòng thao tác chậm lại. Giới hạn xóa 3 lần / phút.' },
});

export const adminSyncLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 1,
  keyGenerator: standardKeyGenerator,
  message: { success: false, error: 'Hệ thống giới hạn tối đa 1 lần làm mới dữ liệu mỗi 10 giây để bảo vệ tài nguyên Database. Vui lòng đợi thêm...' },
});

export const validateKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: standardKeyGenerator,
  message: { error: 'Quá nhiều yêu cầu kiểm tra API Key. Vui lòng thử lại sau 1 phút.' },
});

export const generalActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: standardKeyGenerator,
  message: { error: 'Too many requests. Please try again later.' },
});
