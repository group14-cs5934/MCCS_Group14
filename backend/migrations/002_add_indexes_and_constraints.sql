-- Ensure each product barcode is unique.
ALTER TABLE products
ADD CONSTRAINT products_barcode_unique UNIQUE (barcode);