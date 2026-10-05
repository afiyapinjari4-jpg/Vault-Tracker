// =========================================================================
// PASTE YOUR SUPABASE KEYS BELOW
// =========================================================================
const SUPABASE_URL = "https://bqvndkxtuwzdtqeiojvc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdm5ka3h0dXd6ZHRxZWlvanZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMDg4NDAsImV4cCI6MjEwNjY4NDg0MH0.VNSB_aD3sHdsZOw7O_BZze28B4BaGj60aewscqUS8iI";


const isConfigured = Boolean(
  SUPABASE_URL && 
  !SUPABASE_URL.includes("YOUR_SUPABASE") && 
  SUPABASE_ANON_KEY && 
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
);

const supabaseClient = (isConfigured && window.supabase) 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : null;

const BACKEND_URL = "http://127.0.0.1:8000";

let chartInstance = null;
let currentItems = [];
let scanMode = "single";
let selectedDiet = "Any";
let selectedAppliance = "Any";
let activeTimelineItem = null;
let activeGraphData = { nodes: [], edges: [] };
let graphNodePositions = [];

window.addEventListener("DOMContentLoaded", () => {
  loadInventory();
  initFormListeners();
  initFilterPills();
  initRestockDrawer();
  initIngredientGraph();
  initKitchenMemory();
});

async function loadInventory() {
  const listContainer = document.getElementById("inventory-list");
  if (!supabaseClient) return;

  try {
    const { data, error } = await supabaseClient
      .from("pantry_items")
      .select("*")
      .order("expiry_date", { ascending: true });

    if (error) throw error;
    currentItems = data || [];
    renderCards(currentItems);
    updateMetrics(currentItems);
    updateChart(currentItems);
    loadFutureFridgePredictions();
  } catch (err) {
    listContainer.innerHTML = `<div class="bg-red-50 p-4 rounded-xl text-red-700 text-sm">${err.message}</div>`;
  }
}

function getStatus(expiryDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDateStr);
  const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: "EXPIRED", timeText: `${Math.abs(diffDays)}d ago`, style: "bg-red-100 text-red-600 border border-red-200", category: "Expired" };
  } else if (diffDays === 0) {
    return { label: "EXPIRES TODAY", timeText: "today", style: "bg-orange-100 text-orange-700 border border-orange-200", category: "Expiring Soon" };
  } else if (diffDays <= 7) {
    return { label: "EXPIRING SOON", timeText: `${diffDays}d left`, style: "bg-amber-100 text-amber-700 border border-amber-200", category: "Expiring Soon" };
  } else if (diffDays <= 30) {
    return { label: "WITHIN 30 DAYS", timeText: `${diffDays}d left`, style: "bg-yellow-100 text-yellow-800 border border-yellow-200", category: "Within 30 Days" };
  } else {
    return { label: "FRESH", timeText: `${diffDays}d left`, style: "bg-emerald-100 text-emerald-700 border border-emerald-200", category: "Fresh" };
  }
}

function renderCards(items) {
  const container = document.getElementById("inventory-list");
  if (!items.length) {
    container.innerHTML = `
      <div class="text-center py-10 bg-white/70 rounded-2xl border border-dashed border-purple-200">
        <p class="text-slate-500 text-sm font-semibold">Your pantry vault is empty</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const status = getStatus(item.expiry_date);
    return `
      <div class="bg-white rounded-2xl px-5 py-4 shadow-sm border border-slate-100 flex items-center justify-between gap-4 transition hover:shadow-md">
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl flex-shrink-0 font-bold">
            🍽️
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800 text-sm capitalize">${item.item_name}</span>
              <span class="text-xs font-extrabold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Qty: ${item.quantity}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-1">
              <span class="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase ${status.style}">
                ${status.label} (${status.timeText})
              </span>
              <span class="text-xs text-slate-400">${item.expiry_date}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <button data-action="timeline" data-index="${index}"
                  class="w-8 h-8 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs"
                  title="View Product Lifecycle">
            🌱
          </button>
          <button data-action="decrement" data-index="${index}"
                  class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm">
            -1
          </button>
          <button data-action="delete" data-index="${index}"
                  class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      const item = items[idx];
      if (!item) return;

      const act = btn.dataset.action;
      if (act === "timeline") openTimeline(item.id, item.item_name);
      else if (act === "decrement") decrementItem(item.id, item.quantity, item.item_name);
      else if (act === "delete") deleteItem(item.id);
    });
  });
}

window.decrementItem = async function(id, currentQty, itemName) {
  if (!supabaseClient) return;

  if (currentQty > 1) {
    await supabaseClient.from("pantry_items").update({ quantity: currentQty - 1 }).eq("id", id);
    await supabaseClient.from("pantry_events").insert([{
      pantry_item_id: id,
      item_name: itemName.toLowerCase().trim(),
      event_type: "USED",
      quantity: 1,
      notes: "Partially consumed (-1 qty)"
    }]);
  } else {
    await supabaseClient.from("pantry_items").delete().eq("id", id);
    await supabaseClient.from("pantry_events").insert([{
      pantry_item_id: id,
      item_name: itemName.toLowerCase().trim(),
      event_type: "FINISHED",
      quantity: 1,
      notes: "Finished product"
    }]);
    addDynamicRestock(itemName);
  }
  loadInventory();
};

window.deleteItem = async function(id) {
  if (!supabaseClient) return;
  if (confirm("Remove item from pantry?")) {
    await supabaseClient.from("pantry_items").delete().eq("id", id);
    loadInventory();
  }
};

function updateMetrics(items) {
  let soon = 0, within30 = 0, fresh = 0, exp = 0;
  
  items.forEach(i => {
    const s = getStatus(i.expiry_date);
    if (s.category === "Expiring Soon") soon++;
    else if (s.category === "Within 30 Days") within30++;
    else if (s.category === "Fresh") fresh++;
    else if (s.category === "Expired") exp++;
  });

  document.getElementById("stat-total").innerText = items.length;
  document.getElementById("stat-soon").innerText = soon;
  document.getElementById("stat-within30").innerText = within30;
  document.getElementById("stat-fresh").innerText = fresh;
  document.getElementById("stat-expired").innerText = exp;
}

// --- Future Fridge Prediction Engine ---
async function loadFutureFridgePredictions() {
  const container = document.getElementById("future-fridge-container");
  if (!container || !currentItems.length || !supabaseClient) return;

  try {
    const { data: events, error } = await supabaseClient
      .from("pantry_events")
      .select("*");

    if (error) throw error;

    const res = await fetch(`${BACKEND_URL}/api/forecast/depletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventory: currentItems,
        events: events || []
      })
    });

    if (!res.ok) throw new Error("Forecast calculation failed");
    const data = await res.json();
    const next7 = data.next_7_days || [];
    const unpredicted = data.unpredicted || [];

    if (!next7.length && !unpredicted.length) {
      container.innerHTML = `<p class="text-xs text-slate-400 col-span-4 text-center py-2">Add items to your vault to activate consumption forecasting.</p>`;
      return;
    }

    let cardsHtml = "";

    next7.forEach(p => {
      const timeLabel = p.days_left === 1 ? "Tomorrow" : `In ${p.days_left} days`;
      cardsHtml += `
        <div class="bg-gradient-to-br from-amber-50/60 to-purple-50/40 border border-amber-200/80 rounded-2xl p-4 flex flex-col justify-between shadow-xs">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-black text-amber-700 uppercase tracking-wider">${timeLabel}</span>
              <span class="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">${p.confidence}% confidence</span>
            </div>
            <h4 class="font-extrabold text-sm text-slate-800 capitalize">${p.item_name}</h4>
            <p class="text-[11px] text-slate-500 mt-0.5">Current Stock: <strong class="text-slate-700">${p.current_qty} qty</strong></p>
            <p class="text-[11px] text-slate-500">Depletes: <strong class="text-amber-700">${p.depletion_date}</strong></p>
          </div>
          <div class="mt-3 pt-2 border-t border-amber-100/60 flex items-center justify-between text-[11px]">
            <span class="text-slate-500">Buy: <strong class="text-purple-700">${p.recommended_purchase} qty</strong></span>
            <button data-restock-name="${encodeURIComponent(p.item_name)}" class="forecast-restock-btn text-purple-700 hover:text-purple-900 font-bold hover:underline">+ To Restock</button>
          </div>
        </div>
      `;
    });

    unpredicted.slice(0, 4 - next7.length).forEach(u => {
      cardsHtml += `
        <div class="bg-slate-50/80 border border-slate-200/70 rounded-2xl p-4 flex flex-col justify-between">
          <div>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Learning</span>
            <h4 class="font-extrabold text-sm text-slate-700 capitalize">${u.item_name}</h4>
            <p class="text-[11px] text-slate-400 italic mt-1">Not enough usage history yet.</p>
          </div>
          <p class="text-[10px] text-purple-600 mt-2 font-medium">Log usages in Life Tracker 🌱</p>
        </div>
      `;
    });

    container.innerHTML = cardsHtml;

    container.querySelectorAll(".forecast-restock-btn").forEach(b => {
      b.addEventListener("click", () => {
        addDynamicRestock(decodeURIComponent(b.dataset.restockName));
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="text-xs text-red-500 col-span-4 text-center">Prediction status: ${err.message}</p>`;
  }
}

// --- Food Life Tracker Modal Engine ---
window.openTimeline = async function(itemId, itemName) {
  activeTimelineItem = { id: itemId, name: itemName };
  const modal = document.getElementById("timeline-modal");
  const title = document.getElementById("timeline-title");
  const insight = document.getElementById("timeline-insight");
  const flow = document.getElementById("timeline-flow");

  title.innerHTML = `<span>🌱</span> Life Tracker: <span class="capitalize text-purple-700 font-extrabold">${itemName}</span>`;
  modal.classList.remove("hidden");

  let events = [];
  if (supabaseClient) {
    const { data } = await supabaseClient
      .from("pantry_events")
      .select("*")
      .eq("item_name", itemName.toLowerCase().trim())
      .order("event_date", { ascending: true });
    events = data || [];
  }

  if (!events.length) {
    events = [{
      event_type: "PURCHASED",
      event_date: new Date().toISOString(),
      notes: "Initial vault entry"
    }];
  }

  flow.innerHTML = events.map(ev => {
    const d = new Date(ev.event_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const icons = { PURCHASED: "📦", OPENED: "🔓", USED: "🍳", FINISHED: "✨", WASTED: "⚠️" };
    return `
      <div class="relative">
        <span class="absolute -left-[31px] top-0 w-6 h-6 rounded-full bg-purple-100 border-2 border-purple-400 flex items-center justify-center text-[10px]">
          ${icons[ev.event_type] || "•"}
        </span>
        <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div class="flex justify-between items-center">
            <span class="font-bold text-slate-800 text-xs">${ev.event_type}</span>
            <span class="text-[10px] text-slate-400 font-mono">${d}</span>
          </div>
          ${ev.notes ? `<p class="text-[11px] text-slate-500 mt-0.5">${ev.notes}</p>` : ""}
        </div>
      </div>
    `;
  }).join("");

  try {
    const res = await fetch(`${BACKEND_URL}/api/lifecycle/stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events)
    });
    if (res.ok) {
      const stats = await res.json();
      const match = stats.item_analytics?.find(a => a.item_name.toLowerCase() === itemName.toLowerCase());
      insight.innerText = match ? match.consumption_insight : "Tracking consumption milestones...";
    }
  } catch (err) {
    insight.innerText = "Milestone history active";
  }
};

document.getElementById("btn-mark-opened")?.addEventListener("click", async () => {
  if (!activeTimelineItem || !supabaseClient) return;
  await supabaseClient.from("pantry_events").insert([{
    pantry_item_id: activeTimelineItem.id,
    item_name: activeTimelineItem.name.toLowerCase().trim(),
    event_type: "OPENED",
    notes: "Opened packaging for consumption"
  }]);
  openTimeline(activeTimelineItem.id, activeTimelineItem.name);
  loadFutureFridgePredictions();
});

document.getElementById("btn-mark-finished")?.addEventListener("click", async () => {
  if (!activeTimelineItem || !supabaseClient) return;
  await supabaseClient.from("pantry_events").insert([{
    pantry_item_id: activeTimelineItem.id,
    item_name: activeTimelineItem.name.toLowerCase().trim(),
    event_type: "FINISHED",
    notes: "Zero waste: 100% consumed"
  }]);
  await supabaseClient.from("pantry_items").delete().eq("id", activeTimelineItem.id);
  document.getElementById("timeline-modal").classList.add("hidden");
  loadInventory();
});

document.getElementById("close-timeline-btn")?.addEventListener("click", () => {
  document.getElementById("timeline-modal").classList.add("hidden");
});

// --- Feature 4: Ingredient Relationship Graph Engine ---
function initIngredientGraph() {
  const modalBtn = document.getElementById("graph-modal-btn");
  const modal = document.getElementById("graph-modal");
  const closeBtn = document.getElementById("close-graph-btn");
  const canvas = document.getElementById("relationshipCanvas");

  modalBtn?.addEventListener("click", async () => {
    modal?.classList.remove("hidden");
    await renderRelationshipNetwork();
  });

  closeBtn?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });

  canvas?.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    for (const node of graphNodePositions) {
      const dist = Math.hypot(clickX - node.x, clickY - node.y);
      if (dist <= node.radius + 6) {
        inspectGraphNode(node);
        break;
      }
    }
  });
}

async function renderRelationshipNetwork() {
  const banner = document.getElementById("graph-synergy-banner");
  const canvas = document.getElementById("relationshipCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let historyPairings = [];
  if (supabaseClient) {
    const { data } = await supabaseClient.from("consumption_history").select("*").limit(50);
    historyPairings = data || [];
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/graph/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventory: currentItems,
        history_pairings: historyPairings
      })
    });

    if (!res.ok) throw new Error("Graph calculation failed");
    activeGraphData = await res.json();
    banner.innerText = activeGraphData.synergy_message || "Ingredient affinities calculated.";

    drawGraphCanvas(ctx, canvas, activeGraphData.nodes, activeGraphData.edges);
  } catch (err) {
    banner.innerText = `Affinity Network status: ${err.message}`;
  }
}

function drawGraphCanvas(ctx, canvas, nodes, edges) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  graphNodePositions = [];

  if (!nodes.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Plus Jakarta Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Add items to your vault to generate the ingredient graph.", canvas.width / 2, canvas.height / 2);
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 50;

  nodes.forEach((node, idx) => {
    const angle = (idx / nodes.length) * (2 * Math.PI) - (Math.PI / 2);
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    const nodeRadius = Math.min(Math.max((node.quantity || 1) * 7 + 12, 16), 30);

    graphNodePositions.push({
      ...node,
      x,
      y,
      radius: nodeRadius
    });
  });

  edges.forEach(edge => {
    const src = graphNodePositions.find(n => n.id === edge.source);
    const tgt = graphNodePositions.find(n => n.id === edge.target);
    if (src && tgt) {
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
      ctx.lineWidth = Math.min(edge.strength * 1.5, 4);
      ctx.stroke();
    }
  });

  graphNodePositions.forEach(node => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#f5f3ff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#9333ea";
    ctx.stroke();

    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 11px Plus Jakarta Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.id, node.x, node.y + node.radius + 14);

    ctx.fillStyle = "#7e22ce";
    ctx.font = "bold 10px Plus Jakarta Sans, sans-serif";
    ctx.fillText(`${node.quantity}x`, node.x, node.y + 3);
  });
}

function inspectGraphNode(node) {
  document.getElementById("inspector-name").innerText = node.id;
  document.getElementById("inspector-qty").innerText = `${node.quantity} in stock`;
  document.getElementById("inspector-expiry").innerText = node.expiry_date || "Unknown";

  const pairedEdges = activeGraphData.edges.filter(
    e => e.source === node.id || e.target === node.id
  );
  const partners = pairedEdges.map(e => e.source === node.id ? e.target : e.source);

  const pairsWrap = document.getElementById("inspector-pairs");
  if (!partners.length) {
    pairsWrap.innerHTML = `<span class="text-slate-400 italic text-[11px]">No active pairs yet.</span>`;
  } else {
    pairsWrap.innerHTML = partners.map(p => `
      <span class="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-md text-[10px]">${p}</span>
    `).join("");
  }

  const cookBtn = document.getElementById("inspector-cook-btn");
  if (cookBtn) {
    cookBtn.onclick = () => {
      document.getElementById("graph-modal")?.classList.add("hidden");
      triggerRecipeWithIngredient(node.id);
    };
  }
}

async function triggerRecipeWithIngredient(itemName) {
  const modal = document.getElementById("recipe-modal");
  const container = document.getElementById("recipe-container");
  const alertTag = document.getElementById("recipe-expiring-alert");

  modal.classList.remove("hidden");
  container.innerHTML = `
    <div class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent mb-3"></div>
      <p class="text-sm font-semibold text-slate-700">Synthesizing zero-waste recipes using ${itemName}...</p>
    </div>`;

  alertTag.innerText = `Network Focus: Centering on ${itemName} | Diet: ${selectedDiet} | Appliance: ${selectedAppliance}`;

  const otherItems = currentItems
    .map(i => i.item_name)
    .filter(name => name.toLowerCase() !== itemName.toLowerCase());
  const recipePayloadItems = [itemName, ...otherItems.slice(0, 3)];

  try {
    const res = await fetch(`${BACKEND_URL}/api/recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: recipePayloadItems,
        diet: selectedDiet,
        appliance: selectedAppliance
      })
    });

    if (!res.ok) throw new Error("Could not synthesize network recipe.");
    const data = await res.json();
    const recipes = data.recipes || [];

    container.innerHTML = recipes.map((r, rIdx) => `
      <div class="bg-white rounded-3xl overflow-hidden border border-slate-200/90 shadow-sm flex flex-col md:flex-row gap-6 p-6">
        <div class="md:w-5/12 flex-shrink-0 flex flex-col">
          <img src="${r.image_url}" alt="${r.title}" class="w-full h-56 md:h-64 object-cover rounded-2xl shadow-inner bg-slate-100" 
               onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80';" />
        </div>
        
        <div class="md:w-7/12 space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black uppercase px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">Chef Option #${rIdx + 1}</span>
            <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">⏱ ${r.prep_time || "20 mins"}</span>
          </div>
          
          <h4 class="font-extrabold text-lg text-slate-900">${r.title}</h4>
          
          <div>
            <p class="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">Required Ingredients:</p>
            <div class="flex flex-wrap gap-1.5">
              ${(r.ingredients || []).map(ing => `<span class="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200/60 font-medium">${ing}</span>`).join("")}
            </div>
          </div>

          <div>
            <p class="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">Interactive Steps & Timers:</p>
            <div class="space-y-2 text-xs text-slate-600">
              ${(r.instructions || []).map((step, sIdx) => renderDynamicStep(step, rIdx, sIdx)).join("")}
            </div>
          </div>
        </div>
      </div>
    `).join("");

  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-sm rounded-xl">Error: ${err.message}</div>`;
  }
}

// --- Feature 5: Kitchen Memory Engine ---
function initKitchenMemory() {
  const modalBtn = document.getElementById("memory-modal-btn");
  const modal = document.getElementById("memory-modal");
  const closeBtn = document.getElementById("close-memory-btn");

  modalBtn?.addEventListener("click", async () => {
    modal?.classList.remove("hidden");
    await loadKitchenMemory();
  });

  closeBtn?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });
}

async function loadKitchenMemory() {
  const primaryHabit = document.getElementById("memory-primary-habit");
  const actionableTip = document.getElementById("memory-actionable-tip");
  const recsContainer = document.getElementById("memory-recommendations-list");
  const tableContainer = document.getElementById("memory-habits-table");

  if (!supabaseClient) return;

  primaryHabit.innerText = "Analyzing recurring kitchen habits...";
  actionableTip.innerText = "";

  try {
    const { data: events, error } = await supabaseClient
      .from("pantry_events")
      .select("*");

    if (error) throw error;

    const res = await fetch(`${BACKEND_URL}/api/kitchen-memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: events || [],
        inventory: currentItems
      })
    });

    if (!res.ok) throw new Error("Could not compute kitchen memory");
    const data = await res.json();

    primaryHabit.innerText = data.ai_insight?.primary_habit || "Habit pattern established.";
    actionableTip.innerText = data.ai_insight?.actionable_tip || "";

    const recs = data.recommendations || [];
    if (!recs.length) {
      recsContainer.innerHTML = `
        <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          ✓ Great job! Your consumption rate matches your purchases without significant over-buying.
        </div>`;
    } else {
      recsContainer.innerHTML = recs.map(r => `
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-0.5">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-amber-900 capitalize text-xs">${r.item}</span>
            <span class="text-[10px] bg-amber-200/80 text-amber-900 font-bold px-2 py-0.5 rounded-full">Adjustment</span>
          </div>
          <p class="text-[11px] text-slate-700">${r.pattern}</p>
          <p class="text-[11px] font-bold text-amber-900 mt-1">💡 ${r.action}</p>
        </div>
      `).join("");
    }

    const habits = data.habits || [];
    if (!habits.length) {
      tableContainer.innerHTML = `<p class="text-xs text-slate-400 py-2 italic text-center">Log more items in your vault to unlock consumption ratio records.</p>`;
    } else {
      tableContainer.innerHTML = habits.map(h => `
        <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
          <div>
            <strong class="text-slate-800 capitalize text-xs">${h.item_name}</strong>
            <span class="text-[11px] text-slate-400 ml-2">Bought: ${h.purchased_count} | Used: ${h.consumed_count}</span>
          </div>
          <span class="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-100 text-[11px]">
            ${h.consumption_ratio} Used
          </span>
        </div>
      `).join("");
    }

  } catch (err) {
    primaryHabit.innerText = "Kitchen Memory unavailable";
    actionableTip.innerText = err.message;
  }
}

// --- Restock Map Engine ---
function getRestockMap() {
  return JSON.parse(localStorage.getItem("vault_restock_map") || "{}");
}

function saveRestockMap(map) {
  localStorage.setItem("vault_restock_map", JSON.stringify(map));
  updateRestockUI();
}

function addDynamicRestock(itemName) {
  const map = getRestockMap();
  map[itemName] = (map[itemName] || 0) + 1;
  saveRestockMap(map);
}

function updateRestockUI() {
  const map = getRestockMap();
  const keys = Object.keys(map);
  const badge = document.getElementById("cart-badge");
  const container = document.getElementById("cart-items-container");

  if (badge) {
    badge.innerText = keys.length;
    badge.classList.toggle("hidden", keys.length === 0);
  }

  if (container) {
    if (!keys.length) {
      container.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs">No restock items yet. Add items above or decrement pantry items to 0.</div>`;
      return;
    }
    container.innerHTML = keys.map(k => `
      <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
        <span class="text-xs font-bold text-slate-700 capitalize">${k} <span class="text-purple-600 font-extrabold">(x${map[k]})</span></span>
        <button onclick="removeRestockKey('${k}')" class="text-slate-400 hover:text-red-500 font-bold">&times;</button>
      </div>
    `).join("");
  }
}

window.removeRestockKey = function(key) {
  const map = getRestockMap();
  delete map[key];
  saveRestockMap(map);
};

function initRestockDrawer() {
  const drawer = document.getElementById("cart-drawer");
  document.getElementById("cart-drawer-btn")?.addEventListener("click", () => {
    updateRestockUI();
    drawer?.classList.remove("hidden");
  });
  document.getElementById("close-cart-btn")?.addEventListener("click", () => drawer?.classList.add("hidden"));

  const addBtn = document.getElementById("manual-restock-add-btn");
  const addInput = document.getElementById("manual-restock-input");
  
  addBtn?.addEventListener("click", () => {
    const val = addInput.value.trim();
    if (val) {
      addDynamicRestock(val);
      addInput.value = "";
    }
  });

  addInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const val = addInput.value.trim();
      if (val) {
        addDynamicRestock(val);
        addInput.value = "";
      }
    }
  });

  document.getElementById("copy-cart-btn")?.addEventListener("click", () => {
    const map = getRestockMap();
    const items = Object.entries(map).map(([k, v]) => `• [ ] ${k} (Qty: ${v})`);
    if (!items.length) return alert("Shopping list is empty.");
    navigator.clipboard.writeText("🛒 VaultTracker Restock Checklist:\n" + items.join("\n"));
    alert("Copied checklist to clipboard!");
  });

  document.getElementById("whatsapp-cart-btn")?.addEventListener("click", () => {
    const map = getRestockMap();
    const items = Object.entries(map).map(([k, v]) => `• ${k} (Qty: ${v})`);
    if (!items.length) return alert("Shopping list is empty.");
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent("🛒 *Restock List:*\n" + items.join("\n"))}`, "_blank");
  });

  updateRestockUI();
}

function updateCookButtonLabel() {
  const btnText = document.getElementById("recipe-btn-text");
  if (!btnText) return;

  let label = "Cook Expiring Items";
  if (selectedDiet !== "Any" && selectedAppliance !== "Any") {
    label = `Cook ${selectedDiet} (${selectedAppliance})`;
  } else if (selectedDiet !== "Any") {
    label = `Cook ${selectedDiet}`;
  } else if (selectedAppliance !== "Any") {
    label = `Cook with ${selectedAppliance}`;
  }

  btnText.innerText = label;
}

function initFilterPills() {
  document.querySelectorAll(".filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const type = pill.dataset.type;
      const value = pill.dataset.value;
      
      document.querySelectorAll(`.filter-pill[data-type="${type}"]`).forEach(p => {
        p.classList.remove("active", "border-purple-200", "bg-purple-50", "text-purple-700");
        p.classList.add("bg-white", "text-slate-600", "border-slate-200");
      });
      
      pill.classList.remove("bg-white", "text-slate-600", "border-slate-200");
      pill.classList.add("active", "border-purple-200", "bg-purple-50", "text-purple-700");

      if (type === "diet") selectedDiet = value;
      if (type === "appliance") selectedAppliance = value;

      updateCookButtonLabel();
    });
  });
}

function initFormListeners() {
  document.getElementById("manual-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabaseClient) return alert("Supabase credentials missing in app.js");

    const item_name = document.getElementById("manual-name").value.trim();
    const expiry_date = document.getElementById("manual-expiry").value;
    const quantity = parseInt(document.getElementById("manual-qty").value, 10);

    const { data, error } = await supabaseClient.from("pantry_items").insert([{
      item_name, expiry_date, quantity
    }]).select();

    if (error) {
      alert("Manual Add Error: " + error.message);
    } else {
      if (data && data[0]) {
        await supabaseClient.from("pantry_events").insert([{
          pantry_item_id: data[0].id,
          item_name: item_name.toLowerCase().trim(),
          event_type: "PURCHASED",
          quantity: quantity,
          notes: "Logged via Manual Add"
        }]);
      }
      e.target.reset();
      loadInventory();
    }
  });

  const singleBtn = document.getElementById("scan-mode-single");
  const receiptBtn = document.getElementById("scan-mode-receipt");
  const qtyWrap = document.getElementById("single-qty-wrap");
  const fileInput = document.getElementById("scan-file");

  singleBtn?.addEventListener("click", () => {
    scanMode = "single";
    singleBtn.className = "px-2 py-0.5 rounded-md bg-white text-purple-700 shadow-xs";
    receiptBtn.className = "px-2 py-0.5 rounded-md text-slate-500 hover:text-slate-800";
    qtyWrap?.classList.remove("hidden");
    document.getElementById("file-label").innerText = fileInput.files.length 
      ? fileInput.files[0].name 
      : "Upload product packaging or date stamp";
  });

  receiptBtn?.addEventListener("click", () => {
    scanMode = "receipt";
    receiptBtn.className = "px-2 py-0.5 rounded-md bg-white text-purple-700 shadow-xs";
    singleBtn.className = "px-2 py-0.5 rounded-md text-slate-500 hover:text-slate-800";
    qtyWrap?.classList.add("hidden");
    document.getElementById("file-label").innerText = fileInput.files.length 
      ? fileInput.files[0].name 
      : "Upload supermarket receipt or pantry shelf";
  });

  fileInput?.addEventListener("change", () => {
    if (fileInput.files.length) {
      document.getElementById("file-label").innerText = fileInput.files[0].name;
    }
  });

  document.getElementById("scan-btn")?.addEventListener("click", async () => {
    if (!fileInput.files.length) return alert("Select an image first.");
    const scanBtn = document.getElementById("scan-btn");
    scanBtn.innerText = scanMode === "receipt" ? "Analyzing Receipt..." : "Reading Expiry Label...";
    scanBtn.disabled = true;

    const currentFile = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const ep = scanMode === "receipt" ? "/api/scan-bulk" : "/api/scan";
        const res = await fetch(`${BACKEND_URL}${ep}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: reader.result })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(errData.detail || `Server returned ${res.status}`);
        }

        const out = await res.json();

        if (scanMode === "receipt") {
          const itemsToInsert = out.items || [];
          if (!itemsToInsert.length) throw new Error("No items could be extracted from this receipt.");

          const { data, error } = await supabaseClient.from("pantry_items").insert(itemsToInsert).select();
          if (error) throw new Error("Supabase Database Error: " + error.message);

          if (data && data.length) {
            const eventsToInsert = data.map(item => ({
              pantry_item_id: item.id,
              item_name: item.item_name.toLowerCase().trim(),
              event_type: "PURCHASED",
              quantity: item.quantity,
              notes: "Imported from receipt scan"
            }));
            await supabaseClient.from("pantry_events").insert(eventsToInsert);
          }

          const addedSummary = itemsToInsert.map(i => `${i.item_name} (exp: ${i.expiry_date})`).join("\n• ");
          alert(`✓ Successfully added ${itemsToInsert.length} items from your receipt:\n• ${addedSummary}`);
        } else {
          const quantity = parseInt(document.getElementById("scan-qty").value, 10) || 1;
          const { data, error } = await supabaseClient.from("pantry_items").insert([{
            item_name: out.item_name || "Scanned Item",
            expiry_date: out.expiry_date,
            quantity: quantity
          }]).select();
          if (error) throw new Error("Supabase Database Error: " + error.message);

          if (data && data[0]) {
            await supabaseClient.from("pantry_events").insert([{
              pantry_item_id: data[0].id,
              item_name: data[0].item_name.toLowerCase().trim(),
              event_type: "PURCHASED",
              quantity: quantity,
              notes: "Added via Single OCR Scan"
            }]);
          }

          alert(`✓ Added ${out.item_name} (Expires: ${out.expiry_date}) to your vault!`);
        }

        fileInput.value = "";
        document.getElementById("file-label").innerText = scanMode === "receipt" 
          ? "Upload supermarket receipt or pantry shelf" 
          : "Upload product packaging or date stamp";

        await loadInventory();

      } catch (err) {
        alert(err.message);
      } finally {
        scanBtn.innerText = "AI Scan & Add";
        scanBtn.disabled = false;
      }
    };
    reader.readAsDataURL(currentFile);
  });

  document.getElementById("recipe-btn")?.addEventListener("click", async () => {
    const modal = document.getElementById("recipe-modal");
    const container = document.getElementById("recipe-container");
    const alertTag = document.getElementById("recipe-expiring-alert");

    modal.classList.remove("hidden");
    container.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent mb-3"></div>
        <p class="text-sm font-semibold text-slate-700">Synthesizing tailored recipes & matching photography...</p>
      </div>`;

    const expiringSoon = currentItems
      .filter(i => getStatus(i.expiry_date).category === "Expiring Soon")
      .map(i => i.item_name);

    if (!expiringSoon.length) {
      alertTag.innerText = "Vault Status: Completely fresh";
      container.innerHTML = `<div class="text-center py-8 text-slate-500 text-sm">No items need urgent cooking right now.</div>`;
      return;
    }

    alertTag.innerText = `Rescuing: ${expiringSoon.join(", ")} | Diet: ${selectedDiet} | Tool: ${selectedAppliance}`;

    try {
      const res = await fetch(`${BACKEND_URL}/api/recipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: expiringSoon, diet: selectedDiet, appliance: selectedAppliance })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errData.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      const recipes = data.recipes || [];

      container.innerHTML = recipes.map((r, rIdx) => `
        <div class="bg-white rounded-3xl overflow-hidden border border-slate-200/90 shadow-sm flex flex-col md:flex-row gap-6 p-6">
          <div class="md:w-5/12 flex-shrink-0 flex flex-col">
            <img src="${r.image_url}" alt="${r.title}" class="w-full h-56 md:h-64 object-cover rounded-2xl shadow-inner bg-slate-100" 
                 onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80';" />
          </div>
          
          <div class="md:w-7/12 space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black uppercase px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">Chef Option #${rIdx + 1}</span>
              <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">⏱ ${r.prep_time || "20 mins"}</span>
            </div>
            
            <h4 class="font-extrabold text-lg text-slate-900">${r.title}</h4>
            
            <div>
              <p class="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">Required Ingredients:</p>
              <div class="flex flex-wrap gap-1.5">
                ${(r.ingredients || []).map(ing => `<span class="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200/60 font-medium">${ing}</span>`).join("")}
              </div>
            </div>

            <div>
              <p class="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">Interactive Steps & Timers:</p>
              <div class="space-y-2 text-xs text-slate-600">
                ${(r.instructions || []).map((step, sIdx) => renderDynamicStep(step, rIdx, sIdx)).join("")}
              </div>
            </div>
          </div>
        </div>
      `).join("");

    } catch (e) {
      container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-sm rounded-xl">Error: ${e.message}</div>`;
    }
  });

  document.getElementById("close-modal")?.addEventListener("click", () => {
    document.getElementById("recipe-modal")?.classList.add("hidden");
  });
}

function renderDynamicStep(stepText, rIdx, sIdx) {
  const match = stepText.match(/(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*(min|minute|sec|second)/i);
  let timerBtn = "";

  if (match) {
    const rawVal = parseInt(match[2] || match[1], 10);
    const isSeconds = match[3].toLowerCase().startsWith("sec");
    const totalSecs = isSeconds ? rawVal : rawVal * 60;
    const tId = `timer-${rIdx}-${sIdx}`;

    timerBtn = `
      <button onclick="runDynamicTimer('${tId}', ${totalSecs})" id="${tId}"
              class="ml-2 text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2 py-0.5 rounded-md hover:bg-indigo-100 transition inline-flex items-center gap-1">
        ⏱ Start ${match[0]} Timer
      </button>
    `;
  }

  return `
    <div class="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 transition">
      <input type="checkbox" id="chk-${rIdx}-${sIdx}" class="mt-0.5 rounded text-purple-600 focus:ring-purple-400" />
      <label for="chk-${rIdx}-${sIdx}" class="leading-relaxed text-slate-700 flex-1">
        <span class="font-bold text-purple-600 mr-1">${sIdx + 1}.</span>
        ${stepText}
        ${timerBtn}
      </label>
    </div>
  `;
}

window.runDynamicTimer = function(elementId, seconds) {
  const btn = document.getElementById(elementId);
  if (!btn) return;

  let left = seconds;
  btn.disabled = true;
  btn.classList.add("bg-amber-100", "text-amber-800");

  const timer = setInterval(() => {
    left--;
    const m = Math.floor(left / 60);
    const s = left % 60;
    btn.innerText = `⏳ ${m}:${s < 10 ? '0' : ''}${s}`;

    if (left <= 0) {
      clearInterval(timer);
      btn.innerText = "🔔 Finished!";
      btn.className = "ml-2 text-[10px] bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-2 py-0.5 rounded-md";
      btn.disabled = false;
    }
  }, 1000);
};

function updateChart(items) {
  const counts = { Fresh: 0, "Within 30 Days": 0, "Expiring Soon": 0, Expired: 0 };
  items.forEach(i => {
    const s = getStatus(i.expiry_date);
    counts[s.category] = (counts[s.category] || 0) + 1;
  });

  const canvas = document.getElementById("freshnessChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#10b981", "#eab308", "#f59e0b", "#ef4444"],
        borderWidth: 2,
        borderColor: "#ffffff"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } }
    }
  });
}