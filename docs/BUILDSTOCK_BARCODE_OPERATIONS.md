# BUILDSTOCK — BARCODE & SCANNER OPERATIONS MANUAL
## HARDWARE & KEYBOARD-WEDGE OPERATIONAL GUIDE

---

## 1. Scanner Compatibility & Hardware Setup

BuildStock supports all standard **keyboard-wedge USB and Bluetooth barcode scanners** (e.g. Zebra, Honeywell, Datalogger, Netum).

### Scanner Configuration Rules
1. **Suffix Character**: Configure the physical scanner to emit an `ENTER` (Carriage Return `\r\n` or `\n`) after reading a barcode.
2. **Encoding**: Use standard `Code-128`, `EAN-13`, `QR Code`, or `UPC-A` barcodes.
3. **Focus State**: When using operational screens (Goods Receipt, Physical Counting, Picking, Dispatch), click into the designated search/scan input.

---

## 2. API Endpoint Specification

- **URL**: `GET /api/products/barcode/:barcode`
- **Headers**: `Authorization: Bearer <session>`
- **Response Payload**:
  ```json
  {
    "product": {
      "id": "60d5ec49f1b2c8001f3e9b11",
      "name": "Porcelain Tile 60x60",
      "sku": "TILE-PORC-60",
      "barcode": "6291100123456",
      "trackingMode": "BATCH"
    },
    "exactMatchField": "barcode",
    "warehouseAllocations": [
      {
        "warehouseId": "60d5ec49f1b2c8001f3e9b22",
        "warehouseName": "Main Yard",
        "physicalQuantity": 500,
        "reservedQuantity": 50,
        "availableQuantity": 450
      }
    ],
    "totalPhysicalStock": 500,
    "totalAvailableStock": 450
  }
  ```
