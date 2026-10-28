import { z } from 'zod';

export const loginSchema = z.object({ login: z.string().trim().min(1), password: z.string().min(1) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự').refine(p => p !== 'admin123', 'Không được dùng mật khẩu mặc định'),
});
export type LoginInput = z.infer<typeof loginSchema>;
