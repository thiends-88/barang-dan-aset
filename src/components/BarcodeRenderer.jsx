import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function BarcodeRenderer({
  value,
  width = 1.5,
  height = 42,
  fontSize = 12,
  displayValue = true,
  className = ''
}) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, String(value).trim(), {
          format: 'CODE128',
          width,
          height,
          displayValue,
          fontSize,
          textMargin: 2,
          margin: 4,
          background: 'transparent',
          lineColor: '#1e293b'
        });
      } catch (err) {
        console.warn('Barcode render error:', err);
      }
    }
  }, [value, width, height, fontSize, displayValue]);

  if (!value) return null;

  return <svg ref={svgRef} className={`inline-block ${className}`} />;
}
