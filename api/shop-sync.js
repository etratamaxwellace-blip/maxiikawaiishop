const BLOB = "https://superjsonblob.com/api/jsonBlob/8f11241a-56f0-4f2e-9780-673080f6a669";

function emptySnap() {
  return {
    v: 1,
    orders: [],
    users: [],
    stock: {},
    stockAt: 0,
    customProducts: [],
    productEdits: {},
    ship: null,
    shipAt: 0,
    removedOrderIds: [],
    removedProductIds: [],
    rev: 0
  };
}

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function slimOrder(o) {
  if (!o || typeof o !== "object") return null;
  let copy = Object.assign({}, o);
  ["proof", "proofDataUrl", "orderHtml"].forEach((k) => {
    if (typeof copy[k] === "string" && copy[k].indexOf("data:image") === 0) delete copy[k];
  });
  if (copy.payment && typeof copy.payment === "object") {
    copy.payment = Object.assign({}, copy.payment);
    if (typeof copy.payment.proofImageBase64 === "string" && copy.payment.proofImageBase64.indexOf("data:image") === 0) {
      delete copy.payment.proofImageBase64;
    }
  }
  return copy;
}

function newerAt(a, b) {
  return (Number(a) || 0) >= (Number(b) || 0);
}

function mergeEdits(remote, local) {
  let out = {};
  let ids = new Set([...Object.keys(asObj(remote)), ...Object.keys(asObj(local))]);
  ids.forEach((id) => {
    let r = remote[id];
    let l = local[id];
    if (!r) { out[id] = l; return; }
    if (!l) { out[id] = r; return; }
    let ls = Number(l.savedAt) || 0;
    let rs = Number(r.savedAt) || 0;
    let win = ls >= rs ? l : r;
    let hidden = ls !== rs ? asArr(win.hiddenKeys).slice() : Array.from(new Set([...asArr(r.hiddenKeys), ...asArr(l.hiddenKeys)]));
    let extra = ls !== rs ? asArr(win.extraImages).slice() : Array.from(new Set([...asArr(r.extraImages), ...asArr(l.extraImages)]));
    out[id] = Object.assign({}, r, l, win, { hiddenKeys: hidden, extraImages: extra });
  });
  return out;
}

function shrinkSnap(snap) {
  let guard = 0;
  while (JSON.stringify(snap).length > 700000 && guard < 400) {
    guard += 1;
    let best = null;
    asArr(snap.customProducts).forEach((p) => {
      asArr(p.images).forEach((img, i) => {
        if (typeof img === "string" && img.indexOf("data:") === 0 && (!best || img.length > best.len)) best = { len: img.length, clear: () => { p.images[i] = ""; } };
      });
      asArr(p.variationImages).forEach((img, i) => {
        if (typeof img === "string" && img.indexOf("data:") === 0 && (!best || img.length > best.len)) best = { len: img.length, clear: () => { p.variationImages[i] = ""; } };
      });
    });
    Object.keys(asObj(snap.productEdits)).forEach((id) => {
      let ed = snap.productEdits[id];
      asArr(ed.extraImages).forEach((img, i) => {
        if (typeof img === "string" && img.indexOf("data:") === 0 && (!best || img.length > best.len)) best = { len: img.length, clear: () => { ed.extraImages[i] = ""; } };
      });
    });
    if (!best) break;
    best.clear();
  }
  asArr(snap.customProducts).forEach((p) => {
    if (Array.isArray(p.images)) p.images = p.images.filter(Boolean);
    if (Array.isArray(p.variationImages)) p.variationImages = p.variationImages.map((img) => img || "");
  });
  return snap;
}

function mergeShop(remote, local) {
  remote = Object.assign(emptySnap(), asObj(remote));
  local = Object.assign(emptySnap(), asObj(local));
  let removed = new Set([...asArr(remote.removedOrderIds), ...asArr(local.removedOrderIds)].map(String));
  let removedP = new Set([...asArr(remote.removedProductIds), ...asArr(local.removedProductIds)].map(String));
  let orders = new Map();
  [remote.orders, local.orders].forEach((list) => {
    asArr(list).forEach((raw) => {
      let o = slimOrder(raw);
      if (!o || !o.id || removed.has(String(o.id))) return;
      let prev = orders.get(o.id);
      if (!prev) { orders.set(o.id, o); return; }
      let pu = Number(prev.updatedAt) || Date.parse(prev.date || "") || 0;
      let nu = Number(o.updatedAt) || Date.parse(o.date || "") || 0;
      orders.set(o.id, nu >= pu ? Object.assign({}, prev, o) : Object.assign({}, o, prev));
    });
  });
  let users = new Map();
  [...asArr(remote.users), ...asArr(local.users)].forEach((u) => {
    if (!u || !u.email) return;
    let email = String(u.email).toLowerCase();
    let prev = users.get(email);
    users.set(email, prev ? Object.assign({}, prev, u, { email: prev.email || u.email }) : u);
  });
  let ls = Number(local.stockAt) || 0;
  let rs = Number(remote.stockAt) || 0;
  let stock;
  let stockAt;
  if (Object.keys(asObj(local.stock)).length && ls >= rs) {
    stock = asObj(local.stock);
    stockAt = ls > 1 ? ls : Date.now();
  } else if (Object.keys(asObj(remote.stock)).length) {
    stock = asObj(remote.stock);
    stockAt = rs;
  } else {
    stock = {};
    stockAt = 0;
  }
  let lsh = Number(local.shipAt) || 0;
  let rsh = Number(remote.shipAt) || 0;
  let ship = null;
  let shipAt = 0;
  if (local.ship && typeof local.ship === "object" && lsh >= rsh) {
    ship = local.ship;
    shipAt = lsh > 1 ? lsh : Date.now();
  } else if (remote.ship && typeof remote.ship === "object") {
    ship = remote.ship;
    shipAt = rsh;
  }
  let products = new Map();
  [...asArr(remote.customProducts), ...asArr(local.customProducts)].forEach((p) => {
    if (!p || !p.id || removedP.has(String(p.id))) return;
    let prev = products.get(p.id);
    if (!prev) { products.set(p.id, p); return; }
    products.set(p.id, newerAt(p.savedAt, prev.savedAt) ? p : prev);
  });
  let snap = {
    v: 1,
    orders: Array.from(orders.values()).sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0)).slice(0, 400),
    users: Array.from(users.values()).slice(0, 500),
    stock: stock,
    stockAt: stockAt,
    customProducts: Array.from(products.values()).slice(0, 200),
    productEdits: mergeEdits(remote.productEdits, local.productEdits),
    ship: ship,
    shipAt: shipAt,
    removedOrderIds: Array.from(removed).slice(-500),
    removedProductIds: Array.from(removedP).slice(-500),
    rev: (Number(remote.rev) || 0) + 1,
    updatedAt: Date.now()
  };
  return shrinkSnap(snap);
}

async function readBlob() {
  let res = await fetch(BLOB, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("blob " + res.status);
  let data = await res.json();
  if (!data || typeof data !== "object" || !Array.isArray(data.orders)) return emptySnap();
  return data;
}

async function writeBlob(snap) {
  let res = await fetch(BLOB, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snap)
  });
  if (!res.ok) throw new Error("blob write " + res.status);
}

async function mergeRemote(local) {
  let remote = await readBlob();
  let merged = mergeShop(remote, local);
  await writeBlob(merged);
  let check = await readBlob();
  if (check && Number(check.rev) !== Number(merged.rev)) {
    merged = mergeShop(check, local);
    await writeBlob(merged);
  }
  return merged;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (err) { body = {}; }
  }
  if (!body || typeof body !== "object") body = {};
  try {
    let snap = await mergeRemote(body.snap || {});
    res.status(200).json({ ok: true, snap: snap });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
}

module.exports = handler;
module.exports.mergeShop = mergeShop;
module.exports.emptySnap = emptySnap;
