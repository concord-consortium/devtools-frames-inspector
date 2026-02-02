#!/usr/bin/env node

// Generate markdown documentation from field-info.js
// Run with: node scripts/generate-field-docs.js

const fs = require('fs');
const path = require('path');

// Read and evaluate field-info.js to get FIELD_INFO
const fieldInfoPath = path.join(__dirname, '..', 'field-info.js');
const fieldInfoSource = fs.readFileSync(fieldInfoPath, 'utf8');

// Extract FIELD_INFO object by wrapping in a function that returns it
const FIELD_INFO = eval(`(function() { ${fieldInfoSource}; return FIELD_INFO; })()`);

// Generate markdown
let markdown = `# Message Field Reference

This document describes the fields shown in the Context tab when viewing a message.

`;

for (const [fieldId, info] of Object.entries(FIELD_INFO)) {
  markdown += `## ${info.label}\n\n`;
  markdown += `${info.description}\n\n`;

  if (info.technical) {
    markdown += `${info.technical}\n\n`;
  }

  if (info.filter) {
    markdown += `**Filter:** \`${info.filter}\`\n\n`;
  }

  markdown += `---\n\n`;
}

// Write output
const outputPath = path.join(__dirname, '..', 'docs', 'message-fields.md');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, markdown);

console.log(`Generated: ${outputPath}`);
