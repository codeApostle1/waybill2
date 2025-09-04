/* ================================
   Poultry Store Inventory v2
   - Orders with statuses (pending/received)
   - Unique receive guard
   - Quick lookup & filtering
   - Backward-compatible migration
==================================*/

// -------------------------------
// PRODUCT MASTER
// -------------------------------
const PRODUCTS = [
  "25KG","50KG","AQUA 2MM","AQUA 3MM","BPLUS","CCP","CFP","CGM","CGP",
  "CL1C","CSSP","CL1M","CROWN 2MM","CROWN 3MM","CROWN 4MM","CROWN 6MM","CROWN 9MM","ECO 4MM",
  "ECO 6MM","ECO9MM","TFCON","TGC","TGP","TSSC","TSSCON","UCP",
  "UFP","UGP","UL1C","UPLUS","USSP"
];

// -------------------------------
/** Storage keys */
const KEY_V2 = "psi_orders_v2";
const KEY_INV = "psi_inventory_v2";
const KEY_HIS = "psi_history_v2";

/** In-memory state */
let orders = loadJSON(KEY_V2, []);
let inventory = loadJSON(KEY_INV, []);
let historyLog = loadJSON(KEY_HIS, []);

/** Backward compat migration from your old keys */
(function migrateIfNeeded(){
  const oldWaitlist = loadJSON("waitlist", null);
  const oldInventory = loadJSON("inventory", null);
  const oldHistory = loadJSON("history", null);
  if (oldWaitlist || oldInventory || oldHistory){
    // Convert old waitlist -> orders (pending)
    if (Array.isArray(oldWaitlist)){
      oldWaitlist.forEach(o=>{
        if (!orders.find(x=>x.waybill===o.waybill)){
          orders.push({
            id: genId(),
            waybill: o.waybill,
            date: o.date || today(),
            items: o.items || [],
            status: "pending",
            receivedAt: null
          });
        }
      });
    }
    // Keep inventory, history
    if (Array.isArray(oldInventory)) inventory = oldInventory;
    if (Array.isArray(oldHistory)) historyLog = oldHistory;

    persistAll();
    // Clear old keys to avoid confusion (optional)
    localStorage.removeItem("waitlist");
    localStorage.removeItem("inventory");
    localStorage.removeItem("history");
  }
})();

// -------------------------------
// Helpers
// -------------------------------
function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
function persistAll(){
  saveJSON(KEY_V2, orders);
  saveJSON(KEY_INV, inventory);
  saveJSON(KEY_HIS, historyLog);
}
function genId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function today(){ return new Date().toISOString().slice(0,10); }
function currency(n){ return Number.isFinite(n) ? Number(n).toLocaleString() : ""; }
function toNumber(v, def=0){ const n=Number(v); return Number.isFinite(n) ? n : def; }
function normalize(str){ return (str||"").toString().trim().toLowerCase(); }
function withinRange(dateStr, from, to){
  if (!dateStr) return false;
  const d = dateStr;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// -------------------------------
// Public API for inline scripts (index quick lookup)
// -------------------------------
window.AppAPI = {
  quickLookup(waybill){
    if (!waybill) return null;
    const o = orders.find(x=>normalize(x.waybill)===normalize(waybill));
    return o || null;
  },
  showItemHistory
};

// -------------------------------
// Page init
// -------------------------------
document.addEventListener("DOMContentLoaded", () => {
  setupOrdersPage();
  setupInventoryPage();
  setupHistoryPage();
});

// -------------------------------
// ORDERS
// -------------------------------
function setupOrdersPage(){
  const productSelect = document.getElementById("itemName");
  const orderForm = document.getElementById("orderForm");
  const tableBody = qsa("#waitlistTable tbody")[0];
  const searchInput = document.getElementById("searchWaitlist");
  const confirmArrivalBtn = document.getElementById("confirmArrivalBtn");
  const arrivalInput = document.getElementById("arrivalWaybill");

  if (!productSelect || !orderForm || !tableBody) return; // not on this page

  // Populate products
  productSelect.innerHTML = PRODUCTS.map(p=>`<option value="${p}">${p}</option>`).join("");

  function renderTable(){
    const q = normalize(searchInput?.value);
    const filtered = orders.filter(o=>{
      if (q){
        const inWaybill = normalize(o.waybill).includes(q);
        const inItems = o.items.some(i=>normalize(i.name).includes(q));
        return inWaybill || inItems;
      }
      return true;
    }).sort((a,b)=> (b.date||"").localeCompare(a.date||""));

    tableBody.innerHTML = filtered.map(o=>{
      const itemsStr = o.items.map(i=>`${i.name} (${i.qty})`).join(", ");
      const pill = o.status === "received"
        ? `<span class="pill pill-success">RECEIVED</span>`
        : `<span class="pill pill-warning">PENDING</span>`;
      return `
        <tr>
          <td>${o.waybill}</td>
          <td>${o.date || ""}</td>
          <td>${itemsStr || "<em class='muted'>No items yet</em>"}</td>
          <td>${pill}${o.receivedAt ? `<span class="badge">${o.receivedAt}</span>`:""}</td>
          <td>
            <button class="btn btn-light" onclick="editOrder('${o.id}')">Edit</button>
            <button class="btn" onclick="receiveOrderPrompt('${o.waybill}')" ${o.status==='received' ? 'disabled' : ''}>Receive</button>
            <button class="btn" style="background:#ef4444" onclick="removeWaybill('${o.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Add or append to waybill
  orderForm.addEventListener("submit", (e)=>{
    e.preventDefault();
    const waybill = gid("waybill").value.trim();
    const confirmWaybill = gid("confirmWaybill").value.trim();
    const date = gid("date").value || today();
    const itemName = gid("itemName").value;
    const qty = Math.max(1, toNumber(gid("quantity").value, 0));
    const price = gid("price").value ? toNumber(gid("price").value) : null;

    if (!waybill) return alert("Waybill is required.");
    if (waybill !== confirmWaybill) return alert("Waybill numbers do not match.");
    const existing = orders.find(o=>o.waybill===waybill);

    if (existing){
      if (existing.status === "received"){
        alert("This waybill has already been RECEIVED. You cannot add more items to a received waybill.");
        return;
      }
      existing.date = date; // update last date if needed
      existing.items.push({ name:itemName, qty, price });
    } else {
      orders.push({
        id: genId(),
        waybill,
        date,
        items: [{ name:itemName, qty, price }],
        status: "pending",
        receivedAt: null
      });
    }

    persistAll();
    orderForm.reset();
    renderTable();
  });

  // inline actions
  window.receiveOrderPrompt = function(waybill){
    arrivalInput.value = waybill;
    arrivalInput.focus();
  };

  window.removeWaybill = function(id){
    if (!confirm("Delete this waybill and all its items?")) return;
    orders = orders.filter(o=>o.id!==id);
    persistAll();
    renderTable();
  };

  window.editOrder = function(id){
    const o = orders.find(x=>x.id===id);
    if (!o) return;
    // Simple editor in modal
    const body = `
      <h3>Edit Waybill ${o.waybill}</h3>
      <p class="muted">Change quantities or remove lines. Save to apply.</p>
      <div class="table-wrap" style="max-height:300px;overflow:auto">
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead>
          <tbody>
            ${o.items.map((it,idx)=>`
              <tr>
                <td><input data-idx="${idx}" class="edit-name input" value="${it.name}" list="productList"></td>
                <td><input data-idx="${idx}" class="edit-qty input" type="number" min="1" value="${it.qty}"></td>
                <td><input data-idx="${idx}" class="edit-price input" type="number" min="0" step="0.01" value="${it.price ?? ''}"></td>
                <td><button class="btn" onclick="deleteItemFromOrder('${o.id}', ${idx})" style="background:#ef4444">Remove</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" onclick="addLineToOrder('${o.id}')">Add Line</button>
        <button class="btn btn-primary" onclick="saveOrderEdits('${o.id}')">Save</button>
      </div>
      <datalist id="productList">${PRODUCTS.map(p=>`<option value="${p}">`).join("")}</datalist>
    `;
    openModal(body);
  };

  window.deleteItemFromOrder = function(orderId, idx){
    const o = orders.find(x=>x.id===orderId);
    if (!o) return;
    o.items.splice(idx,1);
    persistAll();
    // re-open editor
    window.editOrder(orderId);
  };

  window.addLineToOrder = function(orderId){
    const o = orders.find(x=>x.id===orderId);
    if (!o) return;
    o.items.push({ name: PRODUCTS[0], qty: 1, price: null });
    persistAll();
    window.editOrder(orderId);
  };

  window.saveOrderEdits = function(orderId){
    const o = orders.find(x=>x.id===orderId);
    if (!o) return;
    const names = qsa(".edit-name");
    const qtys = qsa(".edit-qty");
    const prices = qsa(".edit-price");
    const items = [];
    for (let i=0;i<names.length;i++){
      const name = names[i].value.trim();
      const qty = Math.max(1, toNumber(qtys[i].value, 0));
      const price = prices[i].value ? toNumber(prices[i].value) : null;
      if (name) items.push({ name, qty, price });
    }
    o.items = items;
    persistAll();
    closeModal();
    renderTable();
  };

  // Confirm arrival (global input)
  confirmArrivalBtn.addEventListener("click", ()=>{
    const entered = (arrivalInput.value||"").trim();
    if (!entered) return alert("Enter a waybill number.");
    receiveWaybill(entered);
    arrivalInput.value = "";
    renderTable();
  });

  // live search
  if (searchInput){
    searchInput.addEventListener("input", debounce(renderTable, 150));
  }

  renderTable();
}

// Receive a waybill exactly once
function receiveWaybill(waybill){
  const o = orders.find(x=>x.waybill===waybill);
  if (!o) return alert("Waybill not found.");
  if (o.status === "received") return alert("This waybill has already been received. Duplicate receiving is not allowed.");

  // Move items to inventory
  o.items.forEach(item=>{
    let inv = inventory.find(i=>i.name===item.name);
    if (!inv){
      inv = { name: item.name, qty: 0 };
      inventory.push(inv);
    }
    inv.qty += Number(item.qty||0);

    // History line
    historyLog.push({
      waybill: o.waybill,
      dateOrdered: o.date,
      dateReceived: today(),
      name: item.name,
      qty: Number(item.qty||0)
    });
  });

  o.status = "received";
  o.receivedAt = today();

  persistAll();
  alert(`Waybill ${waybill} received and moved to inventory.`);
}

// -------------------------------
// INVENTORY
// -------------------------------
function setupInventoryPage(){
  const tableBody = qsa("#inventoryTable tbody")[0];
  const search = document.getElementById("searchInventory");
  if (!tableBody) return;

  function render(){
    const q = normalize(search?.value);
    const data = inventory
      .filter(it => q ? normalize(it.name).includes(q) : true)
      .sort((a,b)=> a.name.localeCompare(b.name));

    tableBody.innerHTML = data.map((item, idx)=>`
      <tr>
        <td><a href="#" class="inline" onclick="showItemHistory('${item.name}');return false;">${item.name}</a></td>
        <td>${item.qty}</td>
        <td>
          <button class="btn btn-light" onclick="adjustQty(${idx}, 1)">+ Add</button>
          <button class="btn" onclick="adjustQty(${idx}, -1)">- Subtract</button>
        </td>
      </tr>
    `).join("");
  }

  window.adjustQty = function(index, change){
    const newQty = (inventory[index].qty || 0) + change;
    if (newQty < 0) return alert("Quantity cannot be negative.");
    inventory[index].qty = newQty;
    persistAll();
    render();
  };

  if (search) search.addEventListener("input", debounce(render, 120));
  render();
}

// -------------------------------
// HISTORY
// -------------------------------
function setupHistoryPage(){
  const body = qsa("#historyTable tbody")[0];
  const search = gid("historySearch");
  const dateFrom = gid("dateFrom");
  const dateTo = gid("dateTo");
  const clearBtn = gid("clearFilters");

  if (!body) return;

  function render(){
    const q = normalize(search?.value);
    const from = dateFrom?.value || null;
    const to = dateTo?.value || null;

    const data = historyLog.filter(h=>{
      const hit = !q ||
        normalize(h.waybill).includes(q) ||
        normalize(h.name).includes(q);
      const dateHit = withinRange(h.dateReceived || h.dateOrdered, from, to);
      return hit && dateHit !== false;
    }).sort((a,b)=> (b.dateReceived||"").localeCompare(a.dateReceived||""));

    body.innerHTML = data.map(h=>`
      <tr>
        <td><a href="#" class="inline" onclick="openWaybillDetails('${h.waybill}');return false;">${h.waybill}</a></td>
        <td>${h.dateOrdered || ""}</td>
        <td>${h.dateReceived || ""}</td>
        <td><a href="#" class="inline" onclick="showItemHistory('${h.name}');return false;">${h.name}</a></td>
        <td>${h.qty}</td>
      </tr>
    `).join("");
  }

  window.openWaybillDetails = function(waybill){
    const o = orders.find(x=>x.waybill===waybill);
    if (!o){ alert("Waybill not found."); return; }
    const items = o.items.map(i=>`<li>${i.name} — <strong>${i.qty}</strong>${i.price?` @ ${currency(i.price)}`:""}</li>`).join("");
    const body = `
      <h3>Waybill ${o.waybill}</h3>
      <div class="lookup-grid">
        <div><span class="muted">Status</span><div>${o.status.toUpperCase()}</div></div>
        <div><span class="muted">Date Ordered</span><div>${o.date||""}</div></div>
        <div><span class="muted">Date Received</span><div>${o.receivedAt||"—"}</div></div>
      </div>
      <h4>Items</h4>
      <ul class="tight-list">${items}</ul>
    `;
    openModal(body);
  };

  if (search) search.addEventListener("input", debounce(render, 120));
  if (dateFrom) dateFrom.addEventListener("change", render);
  if (dateTo) dateTo.addEventListener("change", render);
  if (clearBtn) clearBtn.addEventListener("click", ()=>{
    if (search) search.value = "";
    if (dateFrom) dateFrom.value = "";
    if (dateTo) dateTo.value = "";
    render();
  });

  render();
}

// -------------------------------
// SHARED: Item history modal
// -------------------------------
function showItemHistory(itemName){
  const itemHistory = historyLog.filter(h=>h.name===itemName);
  if (itemHistory.length===0){
    alert(`No history found for ${itemName}`);
    return;
  }
  const rows = itemHistory.map(h=>`
    <tr>
      <td>${h.waybill}</td>
      <td>${h.dateOrdered||""}</td>
      <td>${h.dateReceived||""}</td>
      <td>${h.qty}</td>
    </tr>
  `).join("");

  const body = `
    <h3>History for ${itemName}</h3>
    <div class="table-wrap" style="max-height:320px;overflow:auto">
      <table>
        <thead><tr><th>Waybill</th><th>Date Ordered</th><th>Date Received</th><th>Qty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  openModal(body);
}
window.showItemHistory = showItemHistory;

// -------------------------------
// Modal helpers
// -------------------------------
function openModal(html){
  let modal = gid("modal");
  let body = gid("modalBody");
  let close = gid("closeModal");

  if (!modal){
    // fallback for pages without predefined modal
    modal = document.createElement("div");
    modal.id = "modal";
    modal.className = "modal open";
    modal.innerHTML = `
      <div class="modal-content">
        <span id="closeModal" class="close">&times;</span>
        <div id="modalBody">${html}</div>
      </div>`;
    document.body.appendChild(modal);
  } else {
    modal.classList.add("open");
    body.innerHTML = html;
  }

  close = gid("closeModal");
  close.onclick = closeModal;
  modal.onclick = (e)=>{ if (e.target===modal) closeModal(); };
}
function closeModal(){
  const modal = gid("modal");
  if (modal) modal.classList.remove("open");
}

// -------------------------------
// DOM utilities
// -------------------------------
function gid(id){ return document.getElementById(id); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function debounce(fn, ms=150){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}