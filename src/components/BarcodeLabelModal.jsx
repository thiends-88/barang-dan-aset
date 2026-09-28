import React, { useState } from 'react';
import { X, Printer, Package, Copy, Check } from 'lucide-react';
import BarcodeRenderer from './BarcodeRenderer';
import { formatRupiah } from '../utils/formatters';

export default function BarcodeLabelModal({ isOpen, onClose, item }) {
  const [labelCount, setLabelCount] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  const [showSupplier, setShowSupplier] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !item) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(item.kode_barang);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header (No print) */}
        <div className="no-print bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/40 border border-indigo-400/30 flex items-center justify-center">
              <Printer className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="font-bold text-base">Cetak Label Barcode Aset</h3>
              <p className="text-xs text-slate-300">{item.nama_barang}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options Toolbar (No print) */}
        <div className="no-print p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Jumlah Cetak:</span>
            <input
              type="number"
              min="1"
              max="50"
              value={labelCount}
              onChange={(e) => setLabelCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-center font-bold text-slate-800"
            />
            <span className="text-slate-500">label</span>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span>Tampilkan Harga</span>
            </label>
            <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showSupplier}
                onChange={(e) => setShowSupplier(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span>Suplayer</span>
            </label>
          </div>
        </div>

        {/* Label Preview (Printable Area) */}
        <div className="p-6 bg-slate-100 flex flex-col items-center justify-center min-h-[220px]">
          <div className="grid grid-cols-1 gap-4 w-full max-w-sm">
            {Array.from({ length: Math.min(labelCount, 6) }).map((_, idx) => (
              <div
                key={idx}
                className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-4 shadow-sm text-center flex flex-col items-center justify-center relative hover:border-indigo-400 transition"
              >
                {/* Brand / Header */}
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">
                  MANAJEMEN BARANG & ASET ISP
                </div>

                {/* Barcode Render */}
                <div className="my-1">
                  <BarcodeRenderer
                    value={item.kode_barang}
                    width={1.6}
                    height={44}
                    fontSize={12}
                  />
                </div>

                {/* Item Details */}
                <div className="font-bold text-xs text-slate-800 mt-1 max-w-[280px] truncate">
                  {item.nama_barang}
                </div>

                <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2 mt-0.5">
                  <span className="font-mono text-indigo-700 font-semibold">{item.kode_barang}</span>
                  {showPrice && (
                    <>
                      <span>•</span>
                      <span className="font-bold text-slate-700">{formatRupiah(item.harga_barang)}</span>
                    </>
                  )}
                </div>

                {showSupplier && item.referensi_suplayer && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Vendor: {item.referensi_suplayer}
                  </div>
                )}
              </div>
            ))}
          </div>

          {labelCount > 6 && (
            <p className="no-print text-xs text-slate-500 mt-3">
              + {labelCount - 6} label lainnya akan dicetak saat tombol cetak ditekan.
            </p>
          )}
        </div>

        {/* Action Footer (No print) */}
        <div className="no-print p-4 bg-white border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={handleCopyCode}
            className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Kode Disalin!' : 'Salin Kode'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition"
            >
              Batal
            </button>
            <button
              onClick={handlePrint}
              className="px-5 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm flex items-center gap-2 transition"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak Sekarang (Print)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
