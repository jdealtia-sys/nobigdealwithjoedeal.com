/**
 * DOCGEN — how-to-pay panel (NBD Document Standard, section 7)
 *
 * Pins a BUSINESS rule, not a cosmetic one: wallet rails (Venmo / PayPal)
 * appear only on small balances. They are ideal for a job settled at the
 * truck and they save the card fee, but they carry no chargeback path for
 * the homeowner — so a five-figure balance is offered the hosted pay link
 * (card + ACH, with a receipt and a record), Zelle and check instead.
 * WALLET_MAX in document-generator-templates.js is the threshold.
 *
 * Also pins "one QR maximum". Four scannable codes on a payment page is not
 * four times the options, it is choice paralysis exactly where you want none.
 *
 * And pins graceful degradation: an invoice generated before a Stripe link
 * exists must still be a complete, payable document.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const DG_DIR = path.join(__dirname, '..', 'docs/pro/js');
const SRC_DOCGEN = fs.readFileSync(path.join(DG_DIR, 'document-generator.js'), 'utf8');
const SRC_TEMPLATES = fs.readFileSync(path.join(DG_DIR, 'document-generator-templates.js'), 'utf8');

function load(brand) {
  const win = { _brand: () => brand };
  win.window = win;
  const noop = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} });
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement: noop, body: noop() },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(SRC_DOCGEN, sandbox, { filename: 'document-generator.js' });
  vm.runInNewContext(SRC_TEMPLATES, sandbox, { filename: 'document-generator-templates.js' });
  return win.NBDDocGen;
}

const NBD = { legalName: 'No Big Deal Home Solutions', colors: {}, contact: {}, fonts: {} };
const dg = load(NBD);
const WALLETS = [
  { name: 'Venmo', handle: '@JoeDeal' },
  { name: 'PayPal', handle: 'jd@nobigdealwithjoedeal.com' },
];
const QR = 'data:image/png;base64,AAA';
const LINK = 'https://pay.stripe.com/invoice/test';

console.log('DOCGEN PAY PANEL — wallet threshold');
const small = dg.payPanel({ payUrl: LINK, payQr: QR, amount: '$450.00', alternatives: ['Check'], wallets: WALLETS });
const big = dg.payPanel({ payUrl: LINK, payQr: QR, amount: '$8,450.00', alternatives: ['Check'], wallets: WALLETS });
ok('small balance offers Venmo', /Venmo/.test(small));
ok('small balance offers PayPal', /PayPal/.test(small));
ok('large balance does NOT offer Venmo', !/Venmo/.test(big));
ok('large balance does NOT offer PayPal', !/PayPal/.test(big));
ok('large balance leaks no wallet handle', !/@JoeDeal/.test(big));

console.log('\nDOCGEN PAY PANEL — hosted link and QR');
ok('pay button carries the amount', /Pay \$8,450\.00 online/.test(big));
ok('QR rendered beside the button', /Scan to pay/.test(big));
ok('EXACTLY ONE QR image in the panel', (big.match(/<img/g) || []).length === 1);
ok('QR is suppressed without a link to encode',
  !/Scan to pay/.test(dg.payPanel({ payQr: QR, amount: '$450.00', alternatives: ['Check'] })));

console.log('\nDOCGEN PAY PANEL — degradation');
const none = dg.payPanel({ amount: '$8,450.00', alternatives: ['Check — payable to NBD'] });
ok('no button when there is no link', !/online<\/a>/.test(none));
ok('alternatives still render with no link', /Check/.test(none));
ok('empty options render nothing at all', dg.payPanel({}) === '' && dg.payPanel() === '');

console.log('\nDOCGEN PAY PANEL — invoice integration');
const inv = dg.renderInvoice({ homeownerName: 'Jane', address: '1 Main St', invoiceNumber: 'NBD-1', totalAmount: 8450, payUrl: LINK, wallets: WALLETS });
ok('invoice embeds the panel', /How to pay/.test(inv));
ok('invoice at $8,450 shows no wallet handles', !/@JoeDeal/.test(inv));
// "ask for secure link" is the fallback line for an invoice with no hosted
// link. With a link present it is noise and must not appear alongside it.
ok('"ask for secure link" drops out once a real link exists', !/secure link/.test(inv));
ok('"ask for secure link" appears when there is no link',
  /secure link/.test(dg.renderInvoice({ homeownerName: 'J', address: 'A', totalAmount: 100 })));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
