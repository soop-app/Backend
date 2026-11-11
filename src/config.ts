import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  KAKAO_REST_API_KEY: z.string().trim().default(''),
  DATABASE_URL: z.string().trim().default(''),
});

export const config = envSchema.parse(process.env);
