import { rm } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Test setup - clean test storage directories
 */
async function setup() {
  const testDirs = ['./test-storage', './storage'];
  
  for (const dir of testDirs) {
    if (existsSync(dir)) {
      try {
        await rm(dir, { recursive: true, force: true });
        console.log(`✓ Cleaned ${dir}`);
      } catch (err) {
        console.warn(`Warning: Could not clean ${dir}:`, err.message);
      }
    }
  }
}

setup().catch(console.error);
