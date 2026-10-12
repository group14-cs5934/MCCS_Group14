import type { BarcodeType } from 'expo-camera';

/** Barcode formats printed on retail products. The scanner ignores every other kind (QR, etc.). */
export const PRODUCT_BARCODE_TYPES: BarcodeType[] = ['upc_a', 'upc_e', 'ean13', 'ean8'];

/** True if the last digit is the correct GS1 check digit for the digits before it. */
function hasValidCheckDigit(digits: string): boolean {
  let sum = 0;
  // Counting from the right, the check digit has weight 1 and the weights alternate 1, 3, 1, 3...
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return sum % 10 === 0;
}

/**
 * Expands an 8-digit UPC-E code (the short barcode on small packages) to the 12-digit UPC-A it
 * stands for, e.g. "04252614" -> "042100005264". Null if the digits can't be a UPC-E code.
 */
function expandUpcE(digits: string): string | null {
  const numberSystem = digits[0];
  if (numberSystem !== '0' && numberSystem !== '1') {
    return null;
  }
  const [m1, m2, m3, m4, m5, m6] = digits.slice(1, 7);
  const checkDigit = digits[7];

  // The sixth digit says where the zeros that UPC-E leaves out go back in.
  let body: string;
  if (m6 <= '2') {
    body = `${m1}${m2}${m6}0000${m3}${m4}${m5}`;
  } else if (m6 === '3') {
    body = `${m1}${m2}${m3}00000${m4}${m5}`;
  } else if (m6 === '4') {
    body = `${m1}${m2}${m3}${m4}00000${m5}`;
  } else {
    body = `${m1}${m2}${m3}${m4}${m5}0000${m6}`;
  }
  return `${numberSystem}${body}${checkDigit}`;
}

/**
 * Turns what the camera read into the barcode digits to look a product up by, or null if it
 * isn't a complete, correctly read product barcode (wrong length, stray characters, or a check
 * digit that doesn't match, which is what a blurry or partly covered barcode produces).
 *
 * The result is 12 digits for UPC-A and UPC-E, 13 for EAN-13, and 8 for EAN-8.
 *
 * @param type the scanner's name for the barcode format, e.g. "upc_e"
 * @param data the characters the scanner read
 */
export function readProductBarcode(type: string, data: string): string | null {
  if (!/^\d+$/.test(data)) {
    return null;
  }

  let digits = data;
  if (digits.length === 8 && /upc.?e/i.test(type)) {
    digits = expandUpcE(digits) ?? '';
  } else if (digits.length === 13 && digits.startsWith('0')) {
    // iOS reports a UPC-A barcode as EAN-13 with a zero in front. Both mean the same product.
    digits = digits.slice(1);
  }

  if (![8, 12, 13].includes(digits.length) || !hasValidCheckDigit(digits)) {
    return null;
  }
  return digits;
}
