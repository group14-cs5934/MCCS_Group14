"""Product ingestion: pulls real products from a data source into the catalog (US10).

The pipeline has three steps, each its own module, so a different data source only needs a new
connector:

    connectors  fetch raw records from the source (T061)
    transform   clean them up into our product fields, flagging problems (T062)
    load        insert or update them in the database, one product per barcode (T063)

scripts/sync_products.py runs the pipeline from the command line.
"""
