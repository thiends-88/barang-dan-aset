// Identitas barang terpasang mencakup SN: mengganti SN juga berarti menarik unit lama.
export function installedItemKey(item) {
  return JSON.stringify([String(item?.kode_barang || '').trim().toUpperCase(), String(item?.serial_number || '').trim().toUpperCase()]);
}

export function installedItemChanges(oldItems, newItems) {
  const group = rows => {
    const map = new Map();
    for (const item of rows || []) {
      if (!item?.kode_barang) continue;
      const jumlah = Number(item.jumlah);
      if (!Number.isFinite(jumlah) || jumlah <= 0) continue;
      const key = installedItemKey(item);
      const old = map.get(key);
      map.set(key, { ...item, jumlah: jumlah + (old?.jumlah || 0) });
    }
    return map;
  };
  const before = group(oldItems), after = group(newItems);
  const returned = [], added = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const diff = (after.get(key)?.jumlah || 0) - (before.get(key)?.jumlah || 0);
    if (diff < -1e-9) returned.push({ ...before.get(key), jumlah: Number((-diff).toFixed(9)) });
    if (diff > 1e-9) added.push({ ...after.get(key), jumlah: Number(diff.toFixed(9)) });
  }
  return { returned, added };
}
