import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'e2e',timeout:30000,workers:1,reporter:'list',
  use:{baseURL:process.env.BASE_URL??'http://127.0.0.1:3110',browserName:'chromium',trace:'retain-on-failure'},
  webServer:process.env.BASE_URL?undefined:{command:'node e2e/server.mjs',url:'http://127.0.0.1:3110',reuseExistingServer:false},
});
