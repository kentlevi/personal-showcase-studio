const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Expose a function so we can capture browser console logs in terminal
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  
  await page.goto('http://localhost:3000/editor.html');
  
  console.log('Navigated to editor.html');
  
  // Wait for the UI
  await page.waitForSelector('#image-input', { hidden: true });
  
  console.log('Found file input, mocking upload...');
  const inputUploadHandle = await page.$('#image-input');
  await inputUploadHandle.uploadFile('C:\\Users\\Glophics\\.gemini\\antigravity\\brain\\dc51deb1-0a25-4f70-b216-ee904eb50fac\\test_upload_image_1776301576658.png');
  
  console.log('Upload simulated. Waiting 1 second for render...');
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('Clicking export button...');
  await page.click('button.primary-button');
  
  console.log('Export started, waiting 15 seconds to monitor progress...');
  await new Promise(r => setTimeout(r, 15000));
  
  console.log('Closing test...');
  await browser.close();
})();
