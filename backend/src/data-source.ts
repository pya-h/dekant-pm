import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

// Resolve paths for both ts-node (dev) and compiled JS (production)
const isCompiled = path.extname(__filename) === '.js';
const entities = isCompiled
  ? [path.join(__dirname, '**/*.entity.js')]
  : ['src/**/*.entity.ts'];
const migrations = isCompiled
  ? [path.join(__dirname, 'migrations/*.js')]
  : ['src/migrations/*.ts'];

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities,
  migrations,
  synchronize: false,
  logging: true,
});
