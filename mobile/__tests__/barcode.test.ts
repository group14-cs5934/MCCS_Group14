import { readProductBarcode } from '@/utils/barcode';

describe('readProductBarcode', () => {
  it('accepts complete UPC-A, EAN-13, and EAN-8 barcodes', () => {
    expect(readProductBarcode('upc_a', '036000291452')).toBe('036000291452');
    expect(readProductBarcode('ean13', '4006381333931')).toBe('4006381333931');
    expect(readProductBarcode('ean8', '73513537')).toBe('73513537');
  });

  it('gives a UPC-A barcode the same digits whether or not the phone adds a leading zero', () => {
    // iOS reports UPC-A as EAN-13 with a zero in front.
    expect(readProductBarcode('ean13', '0036000291452')).toBe('036000291452');
  });

  it('expands UPC-E to the UPC-A barcode it stands for', () => {
    expect(readProductBarcode('upc_e', '04252614')).toBe('042100005264');
    expect(readProductBarcode('upc_e', '01234565')).toBe('012345000065');
    expect(readProductBarcode('org.gs1.UPC-E', '01234565')).toBe('012345000065');
  });

  it('rejects a read whose check digit is wrong', () => {
    expect(readProductBarcode('upc_a', '036000291453')).toBeNull();
    expect(readProductBarcode('ean13', '4006381333932')).toBeNull();
    expect(readProductBarcode('upc_e', '01234566')).toBeNull();
  });

  it('rejects partial reads and anything that is not only digits', () => {
    expect(readProductBarcode('upc_a', '03600029145')).toBeNull();
    expect(readProductBarcode('upc_a', '')).toBeNull();
    expect(readProductBarcode('upc_a', '03600029145X')).toBeNull();
    expect(readProductBarcode('qr', 'https://example.com')).toBeNull();
  });
});
