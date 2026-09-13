import rateLimit from 'express-rate-limit';

export const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Rất tiếc! Hệ thống phân tích AI đang nhận quá nhiều yêu cầu đồng thời. Vui lòng thử lại sau vài giây.' },
});

export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Quá nhiều lần thử đăng nhập thất bại. Vui lòng khóa tạm thời 15 phút.' },
});

export const adminDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { success: false, error: 'Vui lòng thao tác chậm lại. Giới hạn xóa 3 lần / phút.' },
});

export const adminSyncLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 1,
  message: { success: false, error: 'Hệ thống giới hạn tối đa 1 lần làm mới dữ liệu mỗi 10 giây để bảo vệ tài nguyên Database. Vui lòng đợi thêm...' },
});

export const validateKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Quá nhiều yêu cầu kiểm tra API Key. Vui lòng thử lại sau 1 phút.' },
});

export const generalActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please try again later.' },
});
