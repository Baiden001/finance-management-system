// Receipt printing: a 80 mm thermal-style sales receipt, opened through the
// browser's print dialog. Works with a thermal receipt printer or any printer
// installed on the till device. Browser-only.
//
// The receipt is placed in the page itself and a print-only style hides
// everything else, so only the receipt comes out. (Printing from a hidden
// frame made some browsers, notably Safari on iPhone and iPad, print the
// whole screen instead.)

export const RECEIPT_CONFIG = {
  shopName: "Becca Nena",
  tagline: "BEAUTY STUDIO",
  website: "beccanenabeautystudio.com",
  instagram: "@the.bnb.studio",
  phone: "+233 24 701 8569",
  /** Printed under the contact line. Leave empty to leave it off. */
  storeLocation: "East Legon, Boundary Rd",
} as const;

// QR code for https://beccanenabeautystudio.com, generated once so printing
// needs no internet and no library. If the website address changes, this
// needs regenerating.
const QR_SIZE = 29;
const QR_PATH =
  "M0 0h7v1h-7zM8 0h2v1h-2zM11 0h1v1h-1zM15 0h3v1h-3zM19 0h2v1h-2zM22 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM8 1h1v1h-1zM11 1h2v1h-2zM14 1h2v1h-2zM17 1h1v1h-1zM20 1h1v1h-1zM22 1h1v1h-1zM28 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM10 2h6v1h-6zM18 2h3v1h-3zM22 2h1v1h-1zM24 2h3v1h-3zM28 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h2v1h-2zM12 3h1v1h-1zM16 3h2v1h-2zM20 3h1v1h-1zM22 3h1v1h-1zM24 3h3v1h-3zM28 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM12 4h2v1h-2zM17 4h3v1h-3zM22 4h1v1h-1zM24 4h3v1h-3zM28 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM9 5h2v1h-2zM14 5h1v1h-1zM17 5h1v1h-1zM19 5h2v1h-2zM22 5h1v1h-1zM28 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h7v1h-7zM8 7h1v1h-1zM13 7h2v1h-2zM17 7h2v1h-2zM0 8h1v1h-1zM2 8h2v1h-2zM5 8h3v1h-3zM10 8h5v1h-5zM16 8h5v1h-5zM22 8h1v1h-1zM25 8h1v1h-1zM27 8h2v1h-2zM0 9h2v1h-2zM5 9h1v1h-1zM9 9h1v1h-1zM15 9h2v1h-2zM19 9h6v1h-6zM28 9h1v1h-1zM0 10h1v1h-1zM2 10h3v1h-3zM6 10h1v1h-1zM8 10h2v1h-2zM11 10h2v1h-2zM14 10h2v1h-2zM17 10h2v1h-2zM24 10h1v1h-1zM26 10h2v1h-2zM0 11h2v1h-2zM3 11h3v1h-3zM8 11h2v1h-2zM11 11h1v1h-1zM13 11h3v1h-3zM19 11h1v1h-1zM21 11h2v1h-2zM28 11h1v1h-1zM1 12h2v1h-2zM5 12h2v1h-2zM10 12h3v1h-3zM17 12h1v1h-1zM25 12h2v1h-2zM1 13h1v1h-1zM3 13h3v1h-3zM8 13h2v1h-2zM11 13h1v1h-1zM13 13h1v1h-1zM17 13h3v1h-3zM22 13h1v1h-1zM26 13h3v1h-3zM1 14h1v1h-1zM3 14h1v1h-1zM6 14h1v1h-1zM11 14h1v1h-1zM14 14h1v1h-1zM18 14h4v1h-4zM23 14h2v1h-2zM26 14h3v1h-3zM0 15h1v1h-1zM5 15h1v1h-1zM8 15h6v1h-6zM15 15h2v1h-2zM20 15h3v1h-3zM24 15h1v1h-1zM27 15h1v1h-1zM3 16h6v1h-6zM11 16h2v1h-2zM15 16h1v1h-1zM18 16h1v1h-1zM20 16h2v1h-2zM23 16h3v1h-3zM27 16h1v1h-1zM1 17h3v1h-3zM5 17h1v1h-1zM7 17h1v1h-1zM9 17h1v1h-1zM12 17h2v1h-2zM15 17h1v1h-1zM20 17h1v1h-1zM23 17h1v1h-1zM25 17h3v1h-3zM0 18h1v1h-1zM3 18h2v1h-2zM6 18h1v1h-1zM8 18h2v1h-2zM11 18h1v1h-1zM15 18h2v1h-2zM23 18h2v1h-2zM26 18h1v1h-1zM3 19h3v1h-3zM8 19h1v1h-1zM10 19h1v1h-1zM15 19h3v1h-3zM19 19h3v1h-3zM26 19h1v1h-1zM1 20h2v1h-2zM4 20h4v1h-4zM10 20h1v1h-1zM12 20h2v1h-2zM15 20h12v1h-12zM8 21h2v1h-2zM12 21h3v1h-3zM16 21h3v1h-3zM20 21h1v1h-1zM24 21h5v1h-5zM0 22h7v1h-7zM8 22h2v1h-2zM13 22h1v1h-1zM16 22h2v1h-2zM19 22h2v1h-2zM22 22h1v1h-1zM24 22h2v1h-2zM27 22h1v1h-1zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h1v1h-1zM10 23h3v1h-3zM15 23h2v1h-2zM18 23h1v1h-1zM20 23h1v1h-1zM24 23h2v1h-2zM27 23h2v1h-2zM0 24h1v1h-1zM2 24h3v1h-3zM6 24h1v1h-1zM10 24h2v1h-2zM14 24h2v1h-2zM17 24h1v1h-1zM20 24h5v1h-5zM26 24h2v1h-2zM0 25h1v1h-1zM2 25h3v1h-3zM6 25h1v1h-1zM8 25h2v1h-2zM11 25h2v1h-2zM14 25h3v1h-3zM19 25h3v1h-3zM23 25h3v1h-3zM28 25h1v1h-1zM0 26h1v1h-1zM2 26h3v1h-3zM6 26h1v1h-1zM8 26h5v1h-5zM16 26h4v1h-4zM23 26h1v1h-1zM26 26h1v1h-1zM28 26h1v1h-1zM0 27h1v1h-1zM6 27h1v1h-1zM11 27h1v1h-1zM14 27h1v1h-1zM16 27h1v1h-1zM20 27h1v1h-1zM22 27h1v1h-1zM25 27h1v1h-1zM27 27h1v1h-1zM0 28h7v1h-7zM8 28h3v1h-3zM13 28h3v1h-3zM19 28h2v1h-2zM22 28h2v1h-2zM27 28h1v1h-1z";

export interface ReceiptData {
  /** As stored, e.g. "BN-1052". Printed as #BN-1052. */
  orderNumber: string;
  paidAt: Date;
  cashier: string;
  /** Left out of the receipt when empty. */
  customerName?: string | null;
  items: {
    name: string;
    quantity: number;
    /** What the customer paid per unit. */
    unitPrice: number;
    /** Normal price per unit before any discount. */
    regularPrice: number;
  }[];
  /** Only the method actually used, e.g. "Cash" or "Mobile Money". */
  paymentMethod: string;
}

const ROOT_ID = "bn-receipt-root";
const STYLE_ID = "bn-receipt-style";

const money = (n: number) =>
  `GH\u20B5 ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Everything is scoped to #bn-receipt so it can't touch the rest of the app.
const RECEIPT_CSS = `
  #${ROOT_ID} { display: none; }

  @page { margin: 0; }
  @page { size: 80mm auto; }

  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important;
                 height: auto !important; min-height: 0 !important; overflow: visible !important; }
    body > *:not(#${ROOT_ID}) { display: none !important; }
    #${ROOT_ID} { display: block !important; }
  }

  #bn-receipt { margin: 0 auto; width: 72mm; padding: 4mm 0 6mm; background: #fff; color: #000;
    font-family: Arial, Helvetica, "Segoe UI", "DejaVu Sans", sans-serif; font-size: 11.5px; line-height: 1.35; }
  #bn-receipt * { box-sizing: border-box; }
  #bn-receipt .c { text-align: center; }
  #bn-receipt .logo { width: 24mm; height: auto; display: block; margin: 0 auto 2mm;
    filter: grayscale(1) brightness(0.5) contrast(1.6); }
  #bn-receipt .brand { font-family: Georgia, "Times New Roman", serif; font-size: 22px; letter-spacing: .5px; text-align: center; }
  #bn-receipt .tagline { font-size: 8px; letter-spacing: .42em; margin-top: 1px; padding-left: .42em; text-align: center; }
  #bn-receipt hr { border: 0; border-top: 1px solid #000; margin: 3.2mm 0; }
  #bn-receipt .title { text-align: center; font-weight: bold; font-size: 12.5px; letter-spacing: .5px; margin-bottom: 2mm; }
  #bn-receipt table { width: 100%; border-collapse: collapse; }
  #bn-receipt td, #bn-receipt th { padding: 1.2px 0; vertical-align: top; }
  #bn-receipt .kv td:last-child { text-align: right; }
  #bn-receipt .kv .b { font-weight: bold; }
  #bn-receipt .items th { font-size: 10.5px; padding-bottom: 1.6mm; border-bottom: 1px dashed #000; }
  #bn-receipt .items th:nth-child(1) { text-align: left; }
  #bn-receipt .items th:nth-child(2) { text-align: center; width: 12mm; }
  #bn-receipt .items th:nth-child(3) { text-align: right; width: 24mm; }
  #bn-receipt .items tbody tr:first-child td { padding-top: 2mm; }
  #bn-receipt .items td { padding-bottom: 1.6mm; }
  #bn-receipt .qty { text-align: center; }
  #bn-receipt .amt { text-align: right; white-space: nowrap; }
  #bn-receipt .total td { font-size: 17px; font-weight: bold; }
  #bn-receipt .thanks { font-weight: bold; font-size: 11.5px; letter-spacing: .2px; }
  #bn-receipt .qr { width: 27mm; height: 27mm; display: block; margin: 3mm auto 2mm; }
  #bn-receipt .scan { font-weight: bold; font-size: 10.5px; letter-spacing: .3px; }
  #bn-receipt .small { font-size: 10.5px; }
  #bn-receipt .mt { margin-top: 1.2mm; }
`;

export function buildReceiptBody(r: ReceiptData, origin: string): string {
  const subtotal = r.items.reduce((s, i) => s + i.regularPrice * i.quantity, 0);
  const total = r.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const discount = Math.max(0, subtotal - total);
  const customer = r.customerName?.trim();

  const rows = r.items
    .map(
      (i) => `<tr>
        <td class="name">${esc(i.name)}</td>
        <td class="qty">${i.quantity}</td>
        <td class="amt">${esc(money(i.unitPrice * i.quantity))}</td>
      </tr>`
    )
    .join("");

  const contact = [RECEIPT_CONFIG.instagram, RECEIPT_CONFIG.phone].filter(Boolean).join("  |  ");

  return `
  <div>
    <img class="logo" src="${esc(origin)}/images/logo.png" alt="">
    <div class="brand">${esc(RECEIPT_CONFIG.shopName)}</div>
    <div class="tagline">${esc(RECEIPT_CONFIG.tagline)}</div>
  </div>

  <hr>
  <div class="title">SALES RECEIPT</div>
  <table class="kv">
    <tr><td>Receipt No.</td><td class="b">#${esc(r.orderNumber)}</td></tr>
    <tr><td>Date &amp; time</td><td>${esc(stamp(r.paidAt))}</td></tr>
    <tr><td>Cashier</td><td>${esc(r.cashier)}</td></tr>
    ${customer ? `<tr><td>Customer</td><td>${esc(customer)}</td></tr>` : ""}
  </table>

  <hr>
  <table class="items">
    <thead><tr><th>ITEM</th><th>QTY</th><th>AMOUNT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <hr>
  <table class="kv">
    <tr><td>Subtotal</td><td>${esc(money(subtotal))}</td></tr>
    <tr><td>Discount</td><td>${esc(money(discount))}</td></tr>
  </table>

  <hr>
  <table class="kv total"><tr><td>TOTAL</td><td>${esc(money(total))}</td></tr></table>

  <hr>
  <table class="kv">
    <tr><td>Payment method</td><td class="b">${esc(r.paymentMethod)}</td></tr>
    <tr><td>Amount paid</td><td>${esc(money(total))}</td></tr>
  </table>

  <hr>
  <div class="c thanks">THANK YOU FOR SHOPPING WITH US</div>
  <div class="c">We appreciate your purchase.</div>

  <svg class="qr" viewBox="0 0 ${QR_SIZE} ${QR_SIZE}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <rect width="${QR_SIZE}" height="${QR_SIZE}" fill="#fff"/>
    <path d="${QR_PATH}" fill="#000"/>
  </svg>
  <div class="c scan">SCAN TO VISIT OUR WEBSITE</div>
  <div class="c">${esc(RECEIPT_CONFIG.website)}</div>
  <div class="c small mt">${esc(contact)}</div>
  ${RECEIPT_CONFIG.storeLocation ? `<div class="c small">${esc(RECEIPT_CONFIG.storeLocation)}</div>` : ""}`;
}

/**
 * Prints a receipt. The receipt is put into the page (hidden on screen) and a
 * print-only style hides everything else, so only the receipt is printed.
 */
export async function printReceipt(receipt: ReceiptData) {
  const origin = window.location.origin;

  // Let the logo finish loading first, or it can print as an empty box.
  await new Promise<void>((resolve) => {
    const logo = new Image();
    logo.onload = () => resolve();
    logo.onerror = () => resolve(); // print without the logo rather than not at all
    logo.src = `${origin}/images/logo.png`;
    setTimeout(resolve, 2500);
  });

  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = RECEIPT_CSS;
  document.head.appendChild(style);

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  root.innerHTML = `<div id="bn-receipt">${buildReceiptBody(receipt, origin)}</div>`;

  // Take the print-only style away again afterwards so it can't affect any
  // other printing from the app.
  const cleanup = () => document.getElementById(STYLE_ID)?.remove();
  window.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 120_000);

  window.print();
}
