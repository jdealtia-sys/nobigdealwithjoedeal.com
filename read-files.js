const fs = require('fs');
const path = require('path');

const output = [];

// Read verify-functions.js
const verifyPath = 'C:\\Users\\jonat\\nobigdealwithjoedeal.com\\functions\\verify-functions.js';
const verifyContent = fs.readFileSync(verifyPath, 'utf8');
output.push('=== VERIFY-FUNCTIONS.JS (first 2000 chars) ===');
output.push(verifyContent.substring(0, 2000));
output.push('\n... [file continues] ...\n');

// Read nbd-auth.js
const authPath = 'C:\\Users\\jonat\\nobigdealwithjoedeal.com\\pro\\js\\nbd-auth.js';
const authContent = fs.readFileSync(authPath, 'utf8');
output.push('=== NBD-AUTH.JS (first 2000 chars) ===');
output.push(authContent.substring(0, 2000));
output.push('\n... [file continues] ...\n');

// Read company-admin.js
const adminPath = 'C:\\Users\\jonat\\nobigdealwithjoedeal.com\\pro\\js\\company-admin.js';
const adminContent = fs.readFileSync(adminPath, 'utf8');
output.push('=== COMPANY-ADMIN.JS ===');
output.push(adminContent || '(empty file)');

fs.writeFileSync('C:\\Users\\jonat\\nobigdealwithjoedeal.com\\file-contents.txt', output.join('\n'), 'utf8');
console.log('Files written to file-contents.txt');
